import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

const dbPath = process.env.DATABASE_PATH ?? './data/app.db';
export const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle({ client: sqlite, schema });

// Tx inferred from db.transaction's callback parameter — version-agnostic.
// Phase 1 acceptance criteria C3/C4: Tx must NOT be BetterSQLite3Database;
// it must expose .select() .insert() .update() .delete() .query.
// Verify with `npx tsc --noEmit` after npm install (C1-C6).
type TransactionCallback = Parameters<(typeof db)['transaction']>[0];
export type Tx = Parameters<TransactionCallback>[0];
