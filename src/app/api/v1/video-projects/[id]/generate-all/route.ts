import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { videoProjects } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { enqueueAllSceneGenerations } from '@/services/video-workflow';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const projectId = parseInt(id, 10);
  if (isNaN(projectId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const project = db.select().from(videoProjects).where(eq(videoProjects.id, projectId)).limit(1).get();
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const result = enqueueAllSceneGenerations(projectId);

  return NextResponse.json(result);
}
