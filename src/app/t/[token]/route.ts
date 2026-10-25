import { NextResponse, type NextRequest } from "next/server";
import { redeemLoginLink } from "@/lib/auth/links";
import { startSession } from "@/lib/auth/session";
import { getStudent } from "@/lib/db/repo";
import { startLesson } from "@/lib/lesson/service";

// A link from a text: sign in and open the session on the topic it named.
export async function GET(request: NextRequest, ctx: RouteContext<"/t/[token]">) {
  const { token } = await ctx.params;
  const link = await redeemLoginLink(token);
  if (!link) return NextResponse.redirect(new URL("/login?error=" + encodeURIComponent("That link expired. Sign in, or reply YES for a new one."), request.url));
  const student = await getStudent(link.studentId);
  if (!student) return NextResponse.redirect(new URL("/", request.url));
  await startSession(student.id);
  // Only app paths: a link can never send someone off-site.
  if (link.redirectTo?.startsWith("/") && !link.redirectTo.startsWith("//")) return NextResponse.redirect(new URL(link.redirectTo, request.url));
  if (!link.topicId) return NextResponse.redirect(new URL("/map", request.url));
  const session = await startLesson(student, link.topicId, { withRolePlayer: /nurs|pharm|health/i.test(student.major ?? "") }).catch(() => null);
  return NextResponse.redirect(new URL(session ? `/session/${session.id}` : "/map", request.url));
}
