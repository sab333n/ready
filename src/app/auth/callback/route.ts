import { NextResponse, type NextRequest } from "next/server";
import { upsertStudentByEmail } from "@/lib/db/repo";
import { startSession } from "@/lib/auth/session";
import { supabaseServer } from "@/lib/auth/supabase";
import { supabaseAuthEnabled } from "@/lib/env";

// Google (and any Supabase link) lands here with ?code=... We trade it for the
// verified email, store that student in our database, then use our own cookie.
export async function GET(request: NextRequest) {
  const login = new URL("/login", request.url);
  const failed = request.nextUrl.searchParams.get("error_description");
  if (failed) {
    login.searchParams.set("error", failed.slice(0, 180));
    return NextResponse.redirect(login);
  }

  const code = request.nextUrl.searchParams.get("code");
  if (!supabaseAuthEnabled() || !code) return NextResponse.redirect(new URL("/", request.url));

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  const email = data.user?.email;
  if (error || !email) {
    login.searchParams.set("error", "That sign-in didn't finish. Try Google again.");
    return NextResponse.redirect(login);
  }
  const meta = data.user?.user_metadata as { full_name?: string; name?: string } | undefined;
  const student = await upsertStudentByEmail(email, meta?.full_name ?? meta?.name ?? null);
  await startSession(student.id);
  return NextResponse.redirect(new URL(student.onboardingDoneAt ? "/learn" : "/onboarding", request.url));
}
