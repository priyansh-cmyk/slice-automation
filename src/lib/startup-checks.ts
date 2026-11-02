export function validateEnv(): void {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is required.');
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is required.');
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required.');
  }

  if (process.env.MOCK_USEAPI !== 'true') {
    if (!process.env.USEAPI_TOKEN) {
      throw new Error('USEAPI_TOKEN is required. Set MOCK_USEAPI=true to skip video generation.');
    }
    if (!process.env.GOOGLE_FLOW_EMAIL) {
      throw new Error('GOOGLE_FLOW_EMAIL is required. Set MOCK_USEAPI=true to skip video generation.');
    }
  }

  const directUrl = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
  if (!directUrl) {
    throw new Error('DATABASE_DIRECT_URL (or DATABASE_URL) is required for the worker.');
  }
}
