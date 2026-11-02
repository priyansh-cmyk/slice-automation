import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { videoProjects, videoScreens } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { analyzeScript } from '@/services/video-workflow';

export async function POST(
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

  const breakdown = await analyzeScript(projectId);

  const now = Date.now();

  // Replace existing screens for this project
  db.delete(videoScreens).where(eq(videoScreens.videoProjectId, projectId)).run();
  // Reset breakdown approval when re-analyzing
  db.update(videoProjects)
    .set({ breakdownApprovedAt: null, updatedAt: now })
    .where(eq(videoProjects.id, projectId))
    .run();

  for (const s of breakdown.screens) {
    db.insert(videoScreens)
      .values({
        videoProjectId: projectId,
        screenNumber: s.screenNumber,
        dialogue: s.dialogue,
        position: s.screenNumber,
        durationSeconds: s.durationSeconds ?? null,
        durationNote: s.durationNote ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  const screens = db
    .select()
    .from(videoScreens)
    .where(eq(videoScreens.videoProjectId, projectId))
    .all()
    .sort((a, b) => a.position - b.position);

  return NextResponse.json({ screens, possibleTypos: breakdown.possibleTypos });
}
