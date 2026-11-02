import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { videoProjects, videoScreens, videoGenerations, screenPromptVersions } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { enqueueScreen1ApprovalTasks } from '@/services/video-workflow';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; n: string }> },
): Promise<NextResponse> {
  const { id, n } = await params;
  const projectId = parseInt(id, 10);
  const screenNumber = parseInt(n, 10);
  if (isNaN(projectId) || isNaN(screenNumber)) {
    return NextResponse.json({ error: 'Invalid params' }, { status: 400 });
  }

  const screen = db
    .select()
    .from(videoScreens)
    .where(
      and(
        eq(videoScreens.videoProjectId, projectId),
        eq(videoScreens.screenNumber, screenNumber),
      ),
    )
    .limit(1)
    .get();
  if (!screen) return NextResponse.json({ error: 'Screen not found' }, { status: 404 });

  const body = (await req.json()) as { generationId: number };
  if (!body.generationId) {
    return NextResponse.json({ error: 'generationId required' }, { status: 400 });
  }

  const generation = db
    .select()
    .from(videoGenerations)
    .where(
      and(
        eq(videoGenerations.id, body.generationId),
        eq(videoGenerations.videoScreenId, screen.id),
      ),
    )
    .limit(1)
    .get();
  if (!generation) return NextResponse.json({ error: 'Generation not found for this screen' }, { status: 404 });

  const now = Date.now();
  db.update(videoScreens)
    .set({ approvedGenerationId: body.generationId, updatedAt: now })
    .where(eq(videoScreens.id, screen.id))
    .run();

  // If Screen 1 approved: enqueue async tasks (extract brief + generate remaining prompts)
  // Returns immediately — the worker processes these in the background
  let tasksQueued = 0;
  if (screenNumber === 1) {
    const result = enqueueScreen1ApprovalTasks(projectId, screen.id);
    tasksQueued = result.tasksQueued;
  }

  return NextResponse.json({
    approvedGenerationId: body.generationId,
    tasksQueued,
  });
}
