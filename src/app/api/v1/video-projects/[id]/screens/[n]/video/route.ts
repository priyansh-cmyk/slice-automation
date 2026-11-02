import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { videoScreens, videoGenerations } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import * as fs from 'node:fs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; n: string }> },
): Promise<NextResponse> {
  const { id, n } = await params;
  const projectId = parseInt(id, 10);
  const screenNumber = parseInt(n, 10);
  if (isNaN(projectId) || isNaN(screenNumber)) {
    return NextResponse.json({ error: 'Invalid params' }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const generationIdParam = searchParams.get('generationId');

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

  let generation = generationIdParam
    ? db
        .select()
        .from(videoGenerations)
        .where(
          and(
            eq(videoGenerations.id, parseInt(generationIdParam, 10)),
            eq(videoGenerations.videoScreenId, screen.id),
          ),
        )
        .limit(1)
        .get()
    : db
        .select()
        .from(videoGenerations)
        .where(
          and(
            eq(videoGenerations.videoScreenId, screen.id),
            eq(videoGenerations.status, 'completed'),
          ),
        )
        .all()
        .sort((a, b) => b.createdAt - a.createdAt)[0];

  if (!generation || !generation.videoLocalPath) {
    return NextResponse.json({ error: 'No completed video found' }, { status: 404 });
  }

  const filePath = generation.videoLocalPath;
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: 'Video file not found on disk' }, { status: 404 });
  }

  const buffer = fs.readFileSync(filePath);
  const ext = filePath.endsWith('.webm') ? 'webm' : 'mp4';
  const contentType = ext === 'webm' ? 'video/webm' : 'video/mp4';

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': buffer.byteLength.toString(),
    },
  });
}
