// Fixture validations construct a client during module loading but do not use a live database.
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:1";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "fixture-only-anon-key";
