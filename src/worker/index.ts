import * as path from 'node:path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { acquireLock, releaseLock, startHeartbeat, ownerToken } from './lock';
import { validateEnv, ensureDataDir } from '../lib/startup-checks';
import { db } from '../db';
import { videoGenerations, promptGenerationTasks, videoScreens, videoProjects, screenPromptVersions } from '../db/schema';
import { eq, inArray } from 'drizzle-orm';
import { useapiProvider } from '../providers/useapi/provider';
import { PermanentDownloadError, OutputExpiredError, AuthenticationError } from '../providers/useapi/errors';
import {
  extractAndStoreCreativeBrief,
  generateInitialScreenPrompt,
  submitQueuedGeneration,
} from '../services/video-workflow';

const POLL_INTERVAL_MS = 5_000;

async function main(): Promise<void> {
  validateEnv();
  ensureDataDir();

  if (!acquireLock()) {
    console.log(`[worker] Another worker is active. Exiting. (token prefix: ${ownerToken.slice(0, 8)})`);
    process.exit(0);
  }

  console.log(`[worker] Lock acquired. (token prefix: ${ownerToken.slice(0, 8)})`);
  const heartbeat = startHeartbeat();

  process.on('SIGTERM', () => shutdown('SIGTERM', heartbeat));
  process.on('SIGINT', () => shutdown('SIGINT', heartbeat));

  await runLoop();
}

async function runLoop(): Promise<void> {
  console.log('[worker] Polling loop started.');

  while (true) {
    await tick();
    await sleep(POLL_INTERVAL_MS);
  }
}

async function tick(): Promise<void> {
  // 1. Process prompt generation tasks (extract_brief before generate_prompt)
  await processPromptTasks();

  // 2. Submit queued video generations
  await processQueuedGenerations();

  if (process.env.MOCK_USEAPI === 'true') return;

  // 3. Poll in-flight video generations
  const pending = db
    .select()
    .from(videoGenerations)
    .where(inArray(videoGenerations.status, ['pending', 'processing']))
    .all();

  if (pending.length === 0) return;
  console.log(`[worker] Polling ${pending.length} job(s)…`);

  for (const gen of pending) {
    if (!gen.jobId) continue;
    try {
      const result = await useapiProvider.pollJob(gen.jobId);
      const now = Date.now();

      if (result.status === 'completed' && result.videoUrl) {
        try {
          const downloaded = await useapiProvider.downloadVideo({
            jobId: gen.jobId,
            signedUrl: result.videoUrl,
            outputMediaGenerationId: result.outputMediaGenerationId ?? null,
            jobCompletedAt: now,
          });
          db.update(videoGenerations)
            .set({
              status: 'completed',
              videoLocalPath: downloaded.tempPath,
              updatedAt: now,
            })
            .where(eq(videoGenerations.id, gen.id))
            .run();
          console.log(`[worker] Gen ${gen.id} completed → ${downloaded.tempPath}`);
        } catch (dlErr: unknown) {
          if (dlErr instanceof PermanentDownloadError || dlErr instanceof OutputExpiredError || dlErr instanceof AuthenticationError) {
            db.update(videoGenerations)
              .set({ status: 'failed', errorMessage: (dlErr as Error).message, updatedAt: now })
              .where(eq(videoGenerations.id, gen.id))
              .run();
            console.error(`[worker] Gen ${gen.id} download permanently failed: ${(dlErr as Error).message}`);
          } else {
            console.error(`[worker] Gen ${gen.id} download transient error (will retry):`, dlErr);
          }
        }
      } else if (result.status === 'completed' && !result.videoUrl) {
        db.update(videoGenerations)
          .set({ status: 'failed', errorMessage: 'Video completed but URL was not returned by provider', updatedAt: now })
          .where(eq(videoGenerations.id, gen.id))
          .run();
        console.error(`[worker] Gen ${gen.id} completed with no video URL - marking failed`);
      } else if (result.status === 'failed') {
        db.update(videoGenerations)
          .set({
            status: 'failed',
            errorMessage: result.errorMessage ?? 'Provider reported failure',
            updatedAt: now,
          })
          .where(eq(videoGenerations.id, gen.id))
          .run();
        console.log(`[worker] Gen ${gen.id} failed: ${result.errorMessage}`);
      } else if (result.status === 'started' && gen.status === 'pending') {
        db.update(videoGenerations)
          .set({ status: 'processing', updatedAt: now })
          .where(eq(videoGenerations.id, gen.id))
          .run();
      }
    } catch (err: unknown) {
      console.error(`[worker] Error polling gen ${gen.id}:`, err);
    }
  }
}

async function processPromptTasks(): Promise<void> {
  // Pick one pending task at a time — extract_brief tasks must complete before generate_prompt tasks run
  // for the same project. We order by id (creation order) so extract_brief (created first) runs first.
  const tasks = db
    .select()
    .from(promptGenerationTasks)
    .where(eq(promptGenerationTasks.status, 'pending'))
    .all()
    .sort((a, b) => a.id - b.id);

  if (tasks.length === 0) return;

  for (const task of tasks) {
    // If generate_prompt task: ensure extract_brief for this project is completed first
    if (task.taskType === 'generate_prompt') {
      const extractTask = db
        .select()
        .from(promptGenerationTasks)
        .where(eq(promptGenerationTasks.videoProjectId, task.videoProjectId))
        .all()
        .find((t) => t.taskType === 'extract_brief' && t.status !== 'completed' && t.status !== 'failed');
      if (extractTask) continue; // wait for extract_brief to finish
    }

    const now = Date.now();
    // Mark as processing
    db.update(promptGenerationTasks)
      .set({ status: 'processing', updatedAt: now })
      .where(eq(promptGenerationTasks.id, task.id))
      .run();

    try {
      if (task.taskType === 'extract_brief') {
        // Load the approved Screen 1 prompt text
        const screen1 = task.videoScreenId
          ? db.select().from(videoScreens).where(eq(videoScreens.id, task.videoScreenId)).limit(1).get()
          : null;
        const approvedGenId = screen1?.approvedGenerationId;
        const approvedPromptText = approvedGenId
          ? (() => {
              const gen = db.select().from(videoGenerations).where(eq(videoGenerations.id, approvedGenId)).limit(1).get();
              const pv = gen ? db.select().from(screenPromptVersions).where(eq(screenPromptVersions.id, gen.promptVersionId)).limit(1).get() : null;
              return pv?.promptText ?? null;
            })()
          : null;

        if (!approvedPromptText) {
          throw new Error('No approved prompt found for Screen 1 — cannot extract creative brief');
        }

        await extractAndStoreCreativeBrief(task.videoProjectId, approvedPromptText, task.videoScreenId ?? undefined);
        console.log(`[worker] extract_brief task ${task.id} completed for project ${task.videoProjectId}`);

      } else if (task.taskType === 'generate_prompt') {
        if (!task.videoScreenId) throw new Error('generate_prompt task missing videoScreenId');
        const screen = db.select().from(videoScreens).where(eq(videoScreens.id, task.videoScreenId)).limit(1).get();
        if (!screen) throw new Error(`Screen ${task.videoScreenId} not found`);
        await generateInitialScreenPrompt(task.videoProjectId, task.videoScreenId);
        console.log(`[worker] generate_prompt task ${task.id} completed for screen ${task.videoScreenId}`);
      }

      db.update(promptGenerationTasks)
        .set({ status: 'completed', updatedAt: Date.now() })
        .where(eq(promptGenerationTasks.id, task.id))
        .run();

    } catch (err: unknown) {
      db.update(promptGenerationTasks)
        .set({ status: 'failed', errorMessage: (err instanceof Error ? err.message : String(err)), updatedAt: Date.now() })
        .where(eq(promptGenerationTasks.id, task.id))
        .run();
      console.error(`[worker] prompt task ${task.id} (${task.taskType}) failed:`, err);
    }

    // Only process one task per tick to keep the loop responsive
    break;
  }
}

async function processQueuedGenerations(): Promise<void> {
  const queued = db
    .select()
    .from(videoGenerations)
    .where(eq(videoGenerations.status, 'queued'))
    .all();

  if (queued.length === 0) return;
  console.log(`[worker] Submitting ${queued.length} queued generation(s)…`);

  for (const gen of queued) {
    try {
      await submitQueuedGeneration(gen.id, useapiProvider);
      console.log(`[worker] Queued gen ${gen.id} submitted`);
    } catch (err: unknown) {
      console.error(`[worker] Error submitting queued gen ${gen.id}:`, err);
      // submitQueuedGeneration already marks it failed on error; continue with others
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shutdown(signal: string, heartbeat: NodeJS.Timeout): void {
  console.log(`[worker] ${signal} received. Releasing lock and exiting.`);
  clearInterval(heartbeat);
  releaseLock();
  process.exit(0);
}

main().catch((err) => {
  console.error('[worker] Fatal error:', err);
  process.exit(1);
});
