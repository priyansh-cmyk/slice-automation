import { db, type Tx } from './index';

export function withTransaction<T>(fn: (tx: Tx) => T): T {
  return db.transaction(fn);
}

// behavior: 'immediate' issues BEGIN IMMEDIATE — required for read-then-write
// operations (e.g. worker lock acquisition). Phase 1 criterion C5: confirm
// { behavior: 'immediate' } compiles without error after npm install.
export function withImmediateTransaction<T>(fn: (tx: Tx) => T): T {
  return db.transaction(fn, { behavior: 'immediate' });
}
