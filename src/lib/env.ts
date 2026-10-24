// Central place for configuration. Everything optional degrades to a local-dev fallback.
export const env = {
  databaseUrl: process.env.DATABASE_URL ?? "postgres://localhost:5432/ready_dev",
  sessionSecret: process.env.SESSION_SECRET ?? "dev-only-secret-change-me",
  appUrl: process.env.APP_URL ?? "http://localhost:3000",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  // LLM is opt-in: "anthropic" or "none" (heuristic extraction only).
  llmProvider: (process.env.LLM_PROVIDER ?? "none") as "anthropic" | "none",
  llmModel: process.env.LLM_MODEL ?? "claude-opus-5-5",
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
  isProd: process.env.NODE_ENV === "production",
};

export const supabaseAuthEnabled = () => Boolean(env.supabaseUrl && env.supabaseAnonKey);
