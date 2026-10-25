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
  // Tried in order when the main model is out of quota, overloaded, or retired (Gemini only).
  llmFallbackModels: (process.env.LLM_FALLBACK_MODELS ?? "gemini-3.5-flash-lite")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean),
  // Realtime voice classroom (Gemini Live). Without a key, sessions run in text mode.
  geminiApiKey: process.env.GEMINI_API_KEY,
  voiceModel: process.env.VOICE_MODEL ?? "gemini-2.5-flash-native-audio-latest",
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
  // The Twilio number texts come from (E.164), or a Messaging Service SID (MG...).
  twilioFrom: process.env.TWILIO_FROM,
  // Web push (free nudges). Generate a pair with `npx web-push generate-vapid-keys`.
  vapidPublicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY,
  // Vercel Cron sends "Authorization: Bearer <CRON_SECRET>".
  cronSecret: process.env.CRON_SECRET,
  isProd: process.env.NODE_ENV === "production",
};

/** Texts really go out only with all three Twilio settings; otherwise they are logged as dry runs. */
export const smsSendingEnabled = () => Boolean(env.twilioAccountSid && env.twilioAuthToken && env.twilioFrom);

export const pushEnabled = () => Boolean(env.vapidPublicKey && env.vapidPrivateKey);

export const supabaseAuthEnabled = () => Boolean(env.supabaseUrl && env.supabaseAnonKey);
