import * as fs from 'node:fs';
import * as path from 'node:path';

export function validateEnv(): void {
  if (process.env.MOCK_HIGGSFIELD !== 'true') {
    const key = process.env.ENCRYPTION_KEY ?? '';
    if (!/^[0-9a-fA-F]{64}$/.test(key)) {
      throw new Error(
        'ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes for AES-256-GCM). ' +
        'Set MOCK_HIGGSFIELD=true to skip until Phase C auth is configured.'
      );
    }
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is required for Phase 2 Claude integration.');
  }

  if (process.env.MOCK_USEAPI !== 'true') {
    if (!process.env.USEAPI_TOKEN) {
      throw new Error('USEAPI_TOKEN is required. Set MOCK_USEAPI=true to skip video generation.');
    }
    if (!process.env.GOOGLE_FLOW_EMAIL) {
      throw new Error('GOOGLE_FLOW_EMAIL is required. Set MOCK_USEAPI=true to skip video generation.');
    }
  }
}

export function ensureDataDir(): void {
  const dbPath = process.env.DATABASE_PATH ?? './data/app.db';
  const dataDir = path.dirname(path.resolve(dbPath));
  fs.mkdirSync(dataDir, { recursive: true });
}
