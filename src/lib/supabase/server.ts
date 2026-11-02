import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * User-scoped Supabase client for Server Components and Route Handlers.
 * Uses the caller's session cookie — subject to RLS.
 * Must be called inside a request context (not at module top level).
 */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component (read-only cookies); safe to ignore.
          }
        },
      },
    },
  );
}

/**
 * Service-role Supabase client — bypasses RLS entirely.
 * Use only in admin API routes and internal server-side operations.
 * Never expose to the browser or use in user-facing API routes.
 */
export function createServiceClient() {
  const { createClient: createSBClient } = require('@supabase/supabase-js');
  return createSBClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}
