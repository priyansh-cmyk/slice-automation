import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser-side Supabase client — uses the anon key + session cookie.
 * Subject to RLS. Safe to call multiple times (singleton internally).
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
