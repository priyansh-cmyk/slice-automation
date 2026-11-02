import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { videoProjects, videoScreens, screenPromptVersions, videoGenerations } from '@/db/schema';
import { eq, inArray } from 'drizzle-orm';
import * as path from 'node:path';
import * as fs from 'node:fs';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const projectId = parseInt(id, 10);
  if (isNaN(projectId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const project = db
    .select()
    .from(videoProjects)
    .where(eq(videoProjects.id, projectId))
    .limit(1)
    .get();
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const screens = db
    .select()
    .from(videoScreens)
    .where(eq(videoScreens.videoProjectId, projectId))
    .all()
    .sort((a, b) => a.position - b.position);

  const screenIds = screens.map((s) => s.id);

  // Per-screen prompt presence
  const promptPresence = new Map<number, boolean>();
  if (screenIds.length > 0) {
    const rows = db
      .select({ videoScreenId: screenPromptVersions.videoScreenId })
      .from(screenPromptVersions)
      .where(inArray(screenPromptVersions.videoScreenId, screenIds))
      .all();
    for (const r of rows) promptPresence.set(r.videoScreenId, true);
  }

  // Per-screen generation status
  type GenSummary = { id: number; status: string; videoLocalPath: string | null; updatedAt: number };
  const latestGenByScreen = new Map<number, GenSummary>();
  const latestCompletedLocalByScreen = new Map<number, { id: number; videoLocalPath: string }>();

  if (screenIds.length > 0) {
    const allGens = db
      .select()
      .from(videoGenerations)
      .where(inArray(videoGenerations.videoScreenId, screenIds))
      .all()
      .sort((a, b) => b.updatedAt - a.updatedAt);

    for (const gen of allGens) {
      if (!latestGenByScreen.has(gen.videoScreenId)) {
        latestGenByScreen.set(gen.videoScreenId, {
          id: gen.id,
          status: gen.status,
          videoLocalPath: gen.videoLocalPath ?? null,
          updatedAt: gen.updatedAt,
        });
      }
      if (
        gen.status === 'completed' &&
        gen.videoLocalPath &&
        fs.existsSync(gen.videoLocalPath) &&
        !latestCompletedLocalByScreen.has(gen.videoScreenId)
      ) {
        latestCompletedLocalByScreen.set(gen.videoScreenId, {
          id: gen.id,
          videoLocalPath: gen.videoLocalPath,
        });
      }
    }
  }

  const enrichedScreens = screens.map((s) => ({
    ...s,
    hasPrompt: promptPresence.get(s.id) ?? false,
    latestGen: latestGenByScreen.get(s.id) ?? null,
    latestCompletedLocalGen: latestCompletedLocalByScreen.get(s.id) ?? null,
  }));

  const baseImagePreviewUrl = `/api/v1/uploads/${path.basename(project.baseImagePath)}`;

  return NextResponse.json({ ...project, baseImagePreviewUrl, screens: enrichedScreens });
}
