function hostedAppUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (host) return `https://${host}`;
  return "http://localhost:3000";
}

// Central place for configuration. Everything optional degrades to a local-dev fallback.
export const env = {
  databaseUrl: process.env.DATABASE_URL ?? "postgres://localhost:5432/ready_dev",
  sessionSecret: process.env.SESSION_SECRET ?? "dev-only-secret-change-me",
  appUrl: hostedAppUrl(),
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  // LLM is opt-in: "gemini", "anthropic", or "none" (heuristic extraction only).
  llmProvider: (process.env.LLM_PROVIDER ?? "none") as "gemini" | "anthropic" | "none",
  llmModel: process.env.LLM_MODEL ?? (process.env.LLM_PROVIDER === "anthropic" ? "claude-opus-5-5" : "gemini-3.5-flash"),
  // Realtime voice classroom (Gemini Live). Without a key, sessions run in text mode.
  geminiApiKey: process.env.GEMINI_API_KEY,
  voiceModel: process.env.VOICE_MODEL ?? "gemini-2.5-flash-native-audio-latest",
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
  isProd: process.env.NODE_ENV === "production",
};

export const supabaseAuthEnabled = () => Boolean(env.supabaseUrl && env.supabaseAnonKey);
