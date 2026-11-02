import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { videoScreens, videoGenerations, screenPromptVersions } from '@/db/schema';
import { and, eq } from 'drizzle-orm';

export async function GET(
  _req: NextRequest,
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

  const gens = db
    .select({
      generation: videoGenerations,
      promptVersion: screenPromptVersions,
    })
    .from(videoGenerations)
    .innerJoin(screenPromptVersions, eq(videoGenerations.promptVersionId, screenPromptVersions.id))
    .where(eq(videoGenerations.videoScreenId, screen.id))
    .all()
    .sort((a, b) => b.generation.createdAt - a.generation.createdAt);

  return NextResponse.json(gens);
}
