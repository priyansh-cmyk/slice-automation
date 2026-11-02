import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { videoProjects, promptGenerationTasks } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const projectId = parseInt(id, 10);
  if (isNaN(projectId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const project = db.select().from(videoProjects).where(eq(videoProjects.id, projectId)).limit(1).get();
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const tasks = db
    .select()
    .from(promptGenerationTasks)
    .where(eq(promptGenerationTasks.videoProjectId, projectId))
    .all();

  return NextResponse.json({ tasks });
}
