import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function uploadsDir(): string {
  const storageDir = path.resolve(process.env.STORAGE_DIR ?? './storage');
  const dir = path.join(storageDir, 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'Missing file field' }, { status: 400 });
  }

  const ext = ALLOWED_TYPES[file.type];
  if (!ext) {
    return NextResponse.json(
      { error: `Unsupported image type: ${file.type}. Use JPEG, PNG, WEBP or GIF.` },
      { status: 415 },
    );
  }

  const filename = `${crypto.randomUUID()}.${ext}`;
  const dir = uploadsDir();
  const storedPath = path.join(dir, filename);

  const buffer = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(storedPath, buffer);

  return NextResponse.json(
    {
      filename,
      storedPath,
      previewUrl: `/api/v1/uploads/${filename}`,
      contentType: file.type,
      size: buffer.length,
    },
    { status: 201 },
  );
}
