/**
 * FFmpeg video compilation worker.
 *
 * Picks up pending videoCompilations rows, downloads each screen's approved
 * video from Supabase Storage, concatenates them with FFmpeg, uploads the
 * result, then marks the row completed.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import ffmpegPath from 'ffmpeg-static';
import { db } from '../db';
import {
  adminSettings,
  videoCompilations,
  videoGenerations,
  videoProjects,
  videoScreens,
} from '../db/schema.pg';
import { and, asc, eq, lt } from 'drizzle-orm';

const COMPILATION_LEASE_MS = 30 * 60 * 1000; // 30 min — FFmpeg can be slow on long videos
const BUCKET_VIDEOS = process.env.SUPABASE_BUCKET_VIDEOS ?? 'videos';

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Recover compilations whose lease expired (worker crashed mid-run).
 * Called once on worker startup.
 */
export async function recoverStaleCompilations(): Promise<void> {
  const now = Date.now();
  const staleThreshold = now - COMPILATION_LEASE_MS;
  await db
    .update(videoCompilations)
    .set({ status: 'pending', claimedAt: null, updatedAt: now })
    .where(
      and(
        eq(videoCompilations.status, 'processing'),
        lt(videoCompilations.claimedAt, staleThreshold),
      ),
    );
}

/**
 * Pick up one pending compilation and run it.
 * Returns true if a compilation was processed, false if the queue was empty.
 */
export async function processPendingCompilation(): Promise<boolean> {
  const rows = await db
    .select()
    .from(videoCompilations)
    .where(eq(videoCompilations.status, 'pending'))
    .orderBy(asc(videoCompilations.createdAt))
    .limit(1);

  const compilation = rows[0];
  if (!compilation) return false;

  const now = Date.now();
  await db
    .update(videoCompilations)
    .set({ status: 'processing', claimedAt: now, updatedAt: now })
    .where(eq(videoCompilations.id, compilation.id));

  try {
    const outputStoragePath = await runCompilation(compilation.videoProjectId, compilation.id);
    await db
      .update(videoCompilations)
      .set({ status: 'completed', outputStoragePath, claimedAt: null, updatedAt: Date.now() })
      .where(eq(videoCompilations.id, compilation.id));
    console.log(`[compilation] Job ${compilation.id} completed → ${outputStoragePath}`);
  } catch (err: unknown) {
    await db
      .update(videoCompilations)
      .set({
        status: 'failed',
        claimedAt: null,
        errorMessage: (err instanceof Error ? err.message : String(err)),
        updatedAt: Date.now(),
      })
      .where(eq(videoCompilations.id, compilation.id));
    console.error(`[compilation] Job ${compilation.id} failed:`, err);
  }

  return true;
}

// ── Internal implementation ───────────────────────────────────────────────────

async function runCompilation(projectId: number, compilationId: number): Promise<string> {
  // 1. Fetch project (for CRF override — falls back to adminSettings)
  const projectRows = await db
    .select()
    .from(videoProjects)
    .where(eq(videoProjects.id, projectId))
    .limit(1);
  if (!projectRows[0]) throw new Error(`Project ${projectId} not found`);

  // 2. Resolve CRF from adminSettings
  const settingsRows = await db
    .select()
    .from(adminSettings)
    .where(eq(adminSettings.id, 1))
    .limit(1);
  const crf = settingsRows[0]?.compilationCrf ?? 23;

  // 3. Fetch screens ordered by position
  const screens = await db
    .select()
    .from(videoScreens)
    .where(eq(videoScreens.videoProjectId, projectId))
    .orderBy(asc(videoScreens.position));

  if (screens.length === 0) throw new Error(`Project ${projectId} has no screens`);

  // 4. Resolve approved storage paths for each screen
  const storagePaths: string[] = [];
  for (const screen of screens) {
    if (!screen.approvedGenerationId) {
      throw new Error(
        `Screen ${screen.screenNumber} (id ${screen.id}) of project ${projectId} has no approved generation`,
      );
    }
    const genRows = await db
      .select()
      .from(videoGenerations)
      .where(eq(videoGenerations.id, screen.approvedGenerationId))
      .limit(1);
    const gen = genRows[0];
    if (!gen) throw new Error(`Approved generation ${screen.approvedGenerationId} not found`);
    if (!gen.videoStoragePath) {
      throw new Error(`Generation ${gen.id} has no video in storage (still processing?)`);
    }
    storagePaths.push(gen.videoStoragePath);
  }

  // 5. Download all clips to a temp directory
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `compilation-${compilationId}-`));
  try {
    const supabase = serviceClient();
    const localPaths: string[] = [];

    for (let i = 0; i < storagePaths.length; i++) {
      const storagePath = storagePaths[i];
      const { data, error } = await supabase.storage
        .from(BUCKET_VIDEOS)
        .download(storagePath);
      if (error || !data) {
        throw new Error(`Failed to download clip ${storagePath}: ${error?.message ?? 'no data'}`);
      }
      const localPath = path.join(tmpDir, `clip-${String(i).padStart(3, '0')}.mp4`);
      const arrayBuffer = await data.arrayBuffer();
      await fs.writeFile(localPath, Buffer.from(arrayBuffer));
      localPaths.push(localPath);
    }

    // 6. Run FFmpeg concat
    const outputPath = path.join(tmpDir, 'output.mp4');
    runFfmpegConcat(localPaths, outputPath, crf);

    // 7. Upload compiled video to storage
    const outputBuffer = await fs.readFile(outputPath);
    const outputStoragePath = `compilations/${projectId}/${Date.now()}-compilation-${compilationId}.mp4`;
    const { error: uploadError } = await supabase.storage
      .from(BUCKET_VIDEOS)
      .upload(outputStoragePath, outputBuffer, { contentType: 'video/mp4', upsert: false });
    if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

    return outputStoragePath;
  } finally {
    // Best-effort cleanup
    fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Concatenate MP4 clips in order using FFmpeg's concat demuxer.
 * Re-encodes with H.264 at the given CRF for uniform codec/container.
 */
function runFfmpegConcat(inputPaths: string[], outputPath: string, crf: number): void {
  if (!ffmpegPath) throw new Error('ffmpeg-static binary not found');

  // Write a concat list file
  const listPath = outputPath + '.txt';
  const listContent = inputPaths.map((p) => `file '${p}'`).join('\n');
  require('node:fs').writeFileSync(listPath, listContent);

  const args = [
    '-y',                       // overwrite output
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    '-c:v', 'libx264',
    '-crf', String(crf),
    '-preset', 'fast',
    '-movflags', '+faststart',  // web-optimised moov atom
    '-an',                      // no audio (clips are silent video)
    outputPath,
  ];

  const result = spawnSync(ffmpegPath, args, { stdio: 'pipe' });

  // Clean up list file
  try { require('node:fs').unlinkSync(listPath); } catch { /* ignore */ }

  if (result.status !== 0) {
    const stderr = result.stderr?.toString() ?? '';
    throw new Error(`FFmpeg exited with code ${result.status}: ${stderr.slice(-500)}`);
  }
}

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}
