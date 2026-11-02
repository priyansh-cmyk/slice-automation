/**
 * Phase 1 runtime verification — database checks only.
 * Tests: init, WAL mode, foreign keys, CRUD, integer timestamps.
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import * as schema from '../src/db/schema.ts';
import { projects, screens } from '../src/db/schema.ts';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const dbPath = process.env.DATABASE_PATH ?? './data/app.db';
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const db = drizzle({ client: sqlite, schema });

let pass = 0;
let fail = 0;

function check(label: string, fn: () => void) {
  try {
    fn();
    console.log(`  PASS  ${label}`);
    pass++;
  } catch (err: any) {
    console.error(`  FAIL  ${label}: ${err.message}`);
    fail++;
  }
}

console.log('\n=== Phase 1 DB Verification ===\n');

// 1. WAL mode active
check('WAL mode', () => {
  const row = sqlite.prepare('PRAGMA journal_mode').get() as any;
  if (row.journal_mode !== 'wal') throw new Error(`got: ${row.journal_mode}`);
});

// 2. Foreign keys enabled
check('Foreign keys ON', () => {
  const row = sqlite.prepare('PRAGMA foreign_keys').get() as any;
  if (row.foreign_keys !== 1) throw new Error(`got: ${row.foreign_keys}`);
});

// 3. All Phase 1 tables exist
check('All tables present', () => {
  const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name);
  const expected = ['projects', 'screens', 'script_segments', 'screen_prompts', 'worker_lock'];
  for (const t of expected) {
    if (!tables.includes(t)) throw new Error(`missing table: ${t}`);
  }
});

// 4. Migration table exists (drizzle tracks applied migrations)
check('Drizzle migration journal exists', () => {
  const exists = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'").get();
  if (!exists) throw new Error('__drizzle_migrations table not found');
});

// 5. Insert and read project (UTC integer timestamps)
let projectId!: number;
check('Insert project with UTC integer timestamps', () => {
  const now = Date.now();
  if (typeof now !== 'number' || now < 1_700_000_000_000) throw new Error('bad timestamp');
  const result = db.insert(projects).values({ name: 'Test Project', createdAt: now, updatedAt: now }).run();
  if (result.changes !== 1) throw new Error('insert did not affect 1 row');
  projectId = Number(result.lastInsertRowid);
});

check('Read project back, timestamps are integers', () => {
  const row = db.select().from(projects).where(eq(projects.id, projectId)).limit(1).get();
  if (!row) throw new Error('row not found');
  if (typeof row.createdAt !== 'number') throw new Error(`createdAt is ${typeof row.createdAt}: ${row.createdAt}`);
  if (row.name !== 'Test Project') throw new Error(`name mismatch: ${row.name}`);
});

// 6. Insert screen with FK
let screenId!: number;
check('Insert screen with FK reference', () => {
  const now = Date.now();
  const result = db.insert(screens).values({ projectId, screenNumber: 1, createdAt: now, updatedAt: now }).run();
  if (result.changes !== 1) throw new Error('insert did not affect 1 row');
  screenId = Number(result.lastInsertRowid);
});

// 7. Unique constraint enforced on (project_id, screen_number)
check('Unique constraint rejects duplicate (projectId, screenNumber)', () => {
  const now = Date.now();
  try {
    db.insert(screens).values({ projectId, screenNumber: 1, createdAt: now, updatedAt: now }).run();
    throw new Error('expected UNIQUE constraint violation but none thrown');
  } catch (err: any) {
    if (!err.message?.includes('UNIQUE')) throw new Error(`wrong error: ${err.message}`);
  }
});

// 8. FK constraint: insert screen with non-existent projectId
check('FK constraint rejects orphan screen', () => {
  const now = Date.now();
  try {
    db.insert(screens).values({ projectId: 99999, screenNumber: 1, createdAt: now, updatedAt: now }).run();
    throw new Error('expected FK violation but none thrown');
  } catch (err: any) {
    if (!err.message?.includes('FOREIGN KEY')) throw new Error(`wrong error: ${err.message}`);
  }
});

// 9. Transaction rollback
check('Transaction rolls back on error', () => {
  const before = db.select().from(projects).all().length;
  try {
    db.transaction(() => {
      db.insert(projects).values({ name: 'Rollback Test', createdAt: Date.now(), updatedAt: Date.now() }).run();
      throw new Error('deliberate rollback');
    });
  } catch {}
  const after = db.select().from(projects).all().length;
  if (after !== before) throw new Error(`count changed: ${before} -> ${after}`);
});

// 10. Cleanup
check('Delete test rows', () => {
  db.delete(screens).where(eq(screens.id, screenId)).run();
  db.delete(projects).where(eq(projects.id, projectId)).run();
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
