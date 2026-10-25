import Link from "next/link";
import { redirect } from "next/navigation";
import { currentStudent } from "@/lib/auth/session";
import { recentSessions } from "@/lib/db/lessons";
import { Sidebar, type StudioSession } from "./sidebar";

export async function Studio({ children, mode = "all" }: { children: React.ReactNode; mode?: "teach" | "practice" | "all" }) {
  const student = await currentStudent();
  if (!student) redirect("/");
  const sessions: StudioSession[] = (await recentSessions(student.id, 40)).map((s) => ({
    id: s.id,
    topicName: s.topicName,
    stage: s.stage,
    type: s.type === "practice" ? "practice" : "teach",
    when: ago(s.startedAt),
  }));
  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      <Sidebar key={mode} sessions={sessions} mode={mode} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-4 border-b border-border px-4 py-2 text-sm md:hidden">
          <Link href="/learn" className="font-medium">
            Teaching
          </Link>
          <Link href="/learn?mode=practice" className="text-muted">
            Practice
          </Link>
          <Link href="/map" className="text-muted">
            Semester
          </Link>
        </div>
        {children}
      </div>
    </div>
  );
}

function ago(when: Date) {
  const seconds = (Date.now() - when.getTime()) / 1000;
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  const days = Math.floor(seconds / 86400);
  if (days < 14) return `${days}d ago`;
  return when.toISOString().slice(0, 10);
}
