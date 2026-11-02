import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema.pg';

// Uses the Supabase pooler URL (port 6543, transaction mode) for serverless/Next.js.
// The Railway worker uses a separate direct connection (port 5432) for advisory locks.
const connectionString = process.env.DATABASE_URL!;

const client = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(client, { schema });

// Type helper for transactions
type TransactionCallback = Parameters<(typeof db)['transaction']>[0];
export type Tx = Parameters<TransactionCallback>[0];
