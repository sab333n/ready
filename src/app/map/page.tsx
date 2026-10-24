import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, secondaryButtonClass, Shell } from "@/components/ui";
import { deleteMyData, signOut } from "@/app/auth/actions";
import { currentStudent } from "@/lib/auth/session";
import { getGoals, semesterMap, type MapCourse, type MapDeadline } from "@/lib/db/repo";
import { localDateKey, zonedDate } from "@/lib/time";
import { AddDeadline } from "./AddDeadline";

export default function MapPage() {
  return (
    <Shell>
      <Suspense fallback={<p className="text-muted">Loading your semester…</p>}>
        <SemesterMap />
      </Suspense>
    </Shell>
  );
}

const KIND_LABEL = { exam: "Exam", quiz: "Quiz", assignment: "Assignment", other: "Event" } as const;

async function SemesterMap() {
  const student = await currentStudent();
  if (!student) redirect("/");
  if (!student.onboardingDoneAt) redirect("/onboarding");
  const [{ courses, deadlines, topics }, goals] = await Promise.all([semesterMap(student.id), getGoals(student.id)]);
  const tz = student.timezone;
  const now = new Date();
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const upcoming = deadlines.filter((d) => d.dueAt >= startOfToday(now, tz));
  const past = deadlines.length - upcoming.length;
  const weeks = groupByWeek(upcoming, tz);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Your semester</h1>
        <p className="text-muted">
          {upcoming.length} upcoming deadlines across {courses.length} courses
          {past > 0 ? ` (${past} already past)` : ""}.
        </p>
        {goals.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {goals.map((g) => (
              <li key={g.label} className="rounded-full border border-border px-2.5 py-0.5 text-xs">
                {g.label}
              </li>
            ))}
          </ul>
        )}
      </div>

      {deadlines.length === 0 ? (
        <Card>
          <p>No deadlines yet.</p>
          <Link href="/connect" className="text-accent underline">
            Connect your calendar or upload a syllabus
          </Link>
        </Card>
      ) : (
        <ol className="flex flex-col gap-4">
          {weeks.map(([label, items]) => (
            <li key={label}>
              <h2 className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">{label}</h2>
              <ul className="flex flex-col gap-1.5">
                {items.map((d) => (
                  <DeadlineRow key={d.id} d={d} course={d.courseId ? courseById.get(d.courseId) : undefined} tz={tz} />
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}

      {courses.length > 0 && <AddDeadline courses={courses} />}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Topics by course</h2>
        {courses.map((c) => {
          const list = topics.filter((t) => t.courseId === c.id);
          return (
            <Card key={c.id}>
              <h3 className="font-medium">
                <span className="mr-2 inline-block size-2.5 rounded-full" style={{ background: c.color }} />
                {c.displayCode}
                {c.name && c.name !== c.displayCode ? <span className="font-normal text-muted"> · {c.name}</span> : null}
              </h3>
              {list.length === 0 ? (
                <p className="mt-1 text-sm text-muted">No topics yet. Upload the syllabus to get them.</p>
              ) : (
                <ol className="mt-2 flex flex-col gap-1 text-sm">
                  {list.map((t, i) => (
                    <li key={t.id}>
                      <span className="text-muted">{i + 1}.</span> {t.name}
                      {t.prerequisites.length > 0 && <span className="text-xs text-muted"> · builds on {t.prerequisites.join(", ")}</span>}
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          );
        })}
      </section>

      <footer className="flex flex-wrap gap-2 border-t border-border pt-4">
        <Link href="/connect" className={secondaryButtonClass}>
          Add more files
        </Link>
        <form action={signOut}>
          <button className={secondaryButtonClass}>Sign out</button>
        </form>
        <form action={deleteMyData}>
          <button className={`${secondaryButtonClass} text-[var(--red)]`}>Delete my data</button>
        </form>
      </footer>
    </div>
  );
}

function DeadlineRow({ d, course, tz }: { d: MapDeadline; course?: MapCourse; tz: string }) {
  const date = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(d.dueAt);
  const time = d.allDay ? null : new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(d.dueAt);
  return (
    <li className="flex items-start gap-3 rounded-xl border border-border bg-card px-3 py-2.5" style={{ borderLeft: `4px solid ${course?.color ?? "var(--border)"}` }}>
      <div className="w-16 shrink-0 text-xs text-muted">
        <div className="font-medium text-foreground">{date}</div>
        {time}
      </div>
      <div className="min-w-0 flex-1">
        <div className={d.kind === "exam" ? "font-semibold" : ""}>{d.title}</div>
        <div className="text-xs text-muted">
          {course?.displayCode ?? "Other"} · {KIND_LABEL[d.kind]}
          {d.source !== "ics" ? ` · from ${d.source === "upload" ? "your files" : "you"}` : ""}
        </div>
      </div>
    </li>
  );
}

function startOfToday(now: Date, tz: string): Date {
  return zonedDate(localDateKey(now, tz), "00:00", tz);
}

function groupByWeek(items: MapDeadline[], tz: string): [string, MapDeadline[]][] {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" });
  const groups = new Map<string, MapDeadline[]>();
  for (const d of items) {
    const local = new Date(`${localDateKey(d.dueAt, tz)}T12:00:00Z`);
    const monday = new Date(local.getTime() - ((local.getUTCDay() + 6) % 7) * 864e5);
    const label = `Week of ${fmt.format(monday)}`;
    groups.set(label, [...(groups.get(label) ?? []), d]);
  }
  return [...groups];
}
