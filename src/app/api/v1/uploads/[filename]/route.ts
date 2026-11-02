import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'node:fs';
import * as path from 'node:path';

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

// Only allow UUID-based filenames (no path traversal)
const SAFE_FILENAME = /^[0-9a-f-]{36}\.(jpg|jpeg|png|webp|gif)$/i;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ filename: string }> },
): Promise<NextResponse> {
  const { filename } = await params;

  if (!SAFE_FILENAME.test(filename)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const storageDir = path.resolve(process.env.STORAGE_DIR ?? './storage');
  const filePath = path.join(storageDir, 'uploads', filename);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream';
  const buffer = fs.readFileSync(filePath);

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  });
}
