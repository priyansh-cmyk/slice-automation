import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/index';
import { withImmediateTransaction } from '../db/transactions';
import { workerLock } from '../db/schema';

const HEARTBEAT_INTERVAL_MS = 10_000;
const STALE_THRESHOLD_MS = 30_000;

export const ownerToken = randomUUID();

export function acquireLock(): boolean {
  return withImmediateTransaction((tx) => {
    const now = Date.now();
    const existing = tx
      .select()
      .from(workerLock)
      .where(eq(workerLock.id, 1))
      .limit(1)
      .get();

    if (existing) {
      const isStale = now - existing.heartbeatAt > STALE_THRESHOLD_MS;
      if (!isStale && existing.ownerToken !== ownerToken) {
        return false;
      }
      const result = tx
        .update(workerLock)
        .set({
          ownerToken,
          acquiredAt: existing.ownerToken === ownerToken ? existing.acquiredAt : now,
          heartbeatAt: now,
        })
        .where(eq(workerLock.id, 1))
        .run();
      return result.changes > 0;
    }

    tx.insert(workerLock)
      .values({ id: 1, ownerToken, acquiredAt: now, heartbeatAt: now })
      .run();
    return true;
  });
}

export function sendHeartbeat(): void {
  db.update(workerLock)
    .set({ heartbeatAt: Date.now() })
    .where(eq(workerLock.ownerToken, ownerToken))
    .run();
}

export function releaseLock(): void {
  db.delete(workerLock).where(eq(workerLock.ownerToken, ownerToken)).run();
}

export function startHeartbeat(): NodeJS.Timeout {
  return setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
}
