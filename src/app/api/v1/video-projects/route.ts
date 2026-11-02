import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { videoProjects, videoScreens } from '@/db/schema';
import { desc, eq } from 'drizzle-orm';
import * as fs from 'node:fs';
import * as path from 'node:path';

export async function GET(): Promise<NextResponse> {
  const rows = db.select().from(videoProjects).orderBy(desc(videoProjects.createdAt)).all();
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as {
    name: string;
    originalScript: string;
    baseImagePath: string;
    skillVersion?: string;
    creatorDescription?: string;
  };

  if (!body.name || !body.originalScript) {
    return NextResponse.json({ error: 'name and originalScript are required' }, { status: 400 });
  }

  if (!body.baseImagePath) {
    return NextResponse.json({ error: 'baseImagePath is required' }, { status: 400 });
  }

  if (!fs.existsSync(body.baseImagePath)) {
    return NextResponse.json({ error: 'baseImagePath does not exist on disk' }, { status: 400 });
  }

  const now = Date.now();
  const baseImagePath = body.baseImagePath;

  const result = db
    .insert(videoProjects)
    .values({
      name: body.name,
      baseImagePath,
      originalScript: body.originalScript,
      skillVersion: body.skillVersion ?? 'v1',
      creatorDescription: body.creatorDescription?.trim() || null,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const id = Number(result.lastInsertRowid);
  const project = db.select().from(videoProjects).where(eq(videoProjects.id, id)).limit(1).get();
  return NextResponse.json(project, { status: 201 });
}
