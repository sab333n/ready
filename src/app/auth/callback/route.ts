import { NextResponse, type NextRequest } from "next/server";
import { upsertStudentByEmail } from "@/lib/db/repo";
import { startSession } from "@/lib/auth/session";
import { supabaseServer } from "@/lib/auth/supabase";
import { supabaseAuthEnabled } from "@/lib/env";

// Supabase magic link lands here with ?code=...; we trade it for the verified
// email, then switch to our own session cookie.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const home = new URL("/", request.url);
  if (!supabaseAuthEnabled() || !code) return NextResponse.redirect(home);

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  const email = data.user?.email;
  if (error || !email) {
    home.searchParams.set("error", "That sign-in link expired. Request a new one.");
    return NextResponse.redirect(home);
  }
  const student = await upsertStudentByEmail(email);
  await startSession(student.id);
  return NextResponse.redirect(new URL(student.onboardingDoneAt ? "/map" : "/onboarding", request.url));
}
