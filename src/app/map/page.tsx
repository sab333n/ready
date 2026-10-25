import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Studio } from "@/components/studio";
import { buttonClass, Card, inputClass, secondaryButtonClass } from "@/components/ui";
import { deleteMyData, signOut } from "@/app/auth/actions";
import { currentStudent } from "@/lib/auth/session";
import { startLessonAction } from "@/app/session/actions";
import { stopSharingAction } from "@/app/join/actions";
import { studentClasses } from "@/lib/db/classes";
import { studentVideos } from "@/lib/db/videos";
import { sql } from "@/lib/db";
import { currentConsent } from "@/lib/db/repo";
import { formatHour } from "@/lib/onboarding/flow";
import { formatPhone } from "@/lib/sms/phone";
import { pushDeviceCount, recentTexts } from "@/lib/sms/service";
import { env } from "@/lib/env";
import { settingsConsentText, stopTexts } from "@/app/texts/actions";
import { PushToggle, TextMeNow, TextSettingsForm } from "@/app/texts/forms";
import { studentEvidence } from "@/lib/db/lessons";
import { getGoals, semesterMap, type MapCourse, type MapDeadline, type MapTopic } from "@/lib/db/repo";
import { deadlineReadiness, deadlineTopics, LEVEL_LABEL, topicReadiness, type DeadlineReadiness, type Level } from "@/lib/readiness";
import { localDateKey, zonedDate } from "@/lib/time";
import { AddDeadline } from "./AddDeadline";

export default function MapPage() {
  return (
    <Suspense fallback={<p className="p-8 text-muted">Loading your semester…</p>}>
      <SemesterMap />
    </Suspense>
  );
}

const KIND_LABEL = { exam: "Exam", quiz: "Quiz", assignment: "Assignment", other: "Event" } as const;

async function SemesterMap() {
  const student = await currentStudent();
  if (!student) redirect("/");
  if (!student.onboardingDoneAt) redirect("/onboarding");
  const [{ courses, deadlines, topics }, goals, evidence, classes, smsConsent, texts, [prefs], devices, videos] = await Promise.all([
    semesterMap(student.id),
    getGoals(student.id),
    studentEvidence(student.id),
    studentClasses(student.id),
    currentConsent(student.id, "sms"),
    recentTexts(student.id, 3),
    sql<{ textWindowStart: number | null; textWindowEnd: number | null }[]>`select text_window_start, text_window_end from students where id = ${student.id}`,
    pushDeviceCount(student.id),
    studentVideos(student.id),
  ]);
  const textsOn = Boolean(student.phoneE164 && smsConsent?.granted);
  const hours = prefs?.textWindowStart != null && prefs.textWindowEnd != null ? `${formatHour(prefs.textWindowStart)}–${formatHour(prefs.textWindowEnd)}` : "";
  const tz = student.timezone;
  const now = new Date();
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const upcoming = deadlines.filter((d) => d.dueAt >= startOfToday(now, tz));
  const past = deadlines.length - upcoming.length;
  const weeks = groupByWeek(upcoming, tz);
  const byTopic = new Map(topics.map((t) => [t.id, topicReadiness(t.id, evidence, now)]));
  const readiness = new Map(upcoming.map((d) => [d.id, deadlineReadiness(deadlineTopics(d, topics), byTopic)]));
  const topicById = new Map(topics.map((t) => [t.id, t]));
  // The nearest test in the next three weeks that Ready can say something about.
  const next = upcoming.find((d) => readiness.get(d.id) && d.dueAt.getTime() - now.getTime() < 21 * 864e5);
  const rolePlayer = /nurs|pharm|health/i.test(student.major ?? "");

  return (
    <Studio>
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Your semester</h1>
        <p className="text-muted">
          {upcoming.length} upcoming deadlines across {courses.length} courses
          {past > 0 ? ` (${past} already past)` : ""}.
        </p>
        <Link href="/learn" className={`${buttonClass} mt-3`}>
          Open the map
        </Link>
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

      {next && (
        <UpNext
          d={next}
          r={readiness.get(next.id)!}
          course={next.courseId ? courseById.get(next.courseId) : undefined}
          topicById={topicById}
          now={now}
          rolePlayer={rolePlayer}
        />
      )}

      {videos.length > 0 && (
        <Card className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Videos from your instructors</h2>
          <ul className="flex flex-col gap-1.5">
            {videos.map((v) => (
              <li key={v.id}>
                <Link href={`/video/${v.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2 text-sm hover:border-foreground/30">
                  <span>
                    <span className="font-medium">{v.title}</span>
                    <span className="block text-xs text-muted">
                      {v.instructor} · {v.displayCode} · {v.topicName}
                    </span>
                  </span>
                  <span className={`shrink-0 text-xs ${v.watched ? "text-muted" : "text-[var(--gold)]"}`}>{v.watched ? "Watched" : "▶ Watch"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

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
                  <DeadlineRow key={d.id} d={d} course={d.courseId ? courseById.get(d.courseId) : undefined} tz={tz} readiness={readiness.get(d.id) ?? null} />
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}

      {courses.length > 0 && <AddDeadline courses={courses} />}

      <Card className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold">Reminders</h2>
          <p className="text-sm text-muted">
            When a test is close and a topic isn&apos;t ready, Ready nudges you {hours ? `between ${hours}` : "in the daytime"} with a link straight into a
            10-minute session. Up to 2 a day.
          </p>
        </div>
        <PushToggle publicKey={env.vapidPublicKey ?? null} />
        {(devices > 0 || textsOn) && <TextMeNow />}
        <details className="text-sm" open={textsOn}>
          <summary className="cursor-pointer text-muted">{textsOn ? `Texts to ${formatPhone(student.phoneE164!)}` : "Or get text messages instead"}</summary>
          <div className="mt-2">
            {textsOn ? (
              <form action={stopTexts}>
                <button className="text-xs text-muted underline">Turn off texts</button>
              </form>
            ) : (
              <TextSettingsForm consentText={await settingsConsentText()} phone={student.phoneE164 ? formatPhone(student.phoneE164) : ""} window={hours || "5pm–9pm"} />
            )}
          </div>
        </details>
        {texts.length > 0 && (
          <ul className="flex flex-col gap-1.5 border-t border-border pt-3 text-sm">
            {texts.map((t, i) => (
              <li key={i} className={t.direction === "in" ? "text-right" : ""}>
                <span className={`inline-block max-w-[85%] rounded-2xl px-3 py-1.5 ${t.direction === "in" ? "bg-accent text-accent-fg" : "bg-background"}`}>{t.body}</span>
                <span className="block text-xs text-muted">
                  {t.direction === "in"
                    ? "You"
                    : t.status === "dry_run"
                      ? `Not sent (${t.channel === "push" ? "notifications not configured" : "Twilio not connected"})`
                      : t.status === "failed"
                        ? "Failed to send"
                        : t.channel === "push"
                          ? "Ready · notification"
                          : "Ready · text"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold">Share with an instructor</h2>
          <p className="text-sm text-muted">Your instructor can see your readiness for their course, never your notes or what you said. You can stop any time.</p>
        </div>
        {classes.length > 0 && (
          <ul className="flex flex-col gap-2">
            {classes.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-3 py-2 text-sm">
                <span>
                  <span className="font-medium">{c.displayCode}</span> · {c.instructor}
                  <span className={`ml-2 text-xs ${c.sharing ? "text-[var(--green)]" : "text-muted"}`}>{c.sharing ? "Sharing" : "Not sharing"}</span>
                </span>
                {c.sharing ? (
                  <form action={stopSharingAction}>
                    <input type="hidden" name="classId" value={c.id} />
                    <button className="text-xs underline">Stop sharing</button>
                  </form>
                ) : (
                  // Sharing again shows the consent wording again.
                  <Link href={`/join?code=${c.joinCode}`} className="text-xs underline">
                    Share again
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
        <form action="/join" className="flex gap-2">
          <input name="code" required placeholder="Class code, e.g. PHARM-7KQ2" aria-label="Class code" className={`${inputClass} uppercase placeholder:normal-case`} />
          <button className={secondaryButtonClass}>Next</button>
        </form>
      </Card>

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
                <p className="mt-1 text-sm text-muted">No topics yet. Name one on the learn page and Ready will write the outline, or upload a syllabus.</p>
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
    </Studio>
  );
}

const LEVEL_COLOR: Record<Level, string> = {
  not_ready: "var(--red)",
  unmeasured: "var(--muted)",
  getting_there: "var(--yellow)",
  ready: "var(--green)",
};

function ReadinessChip({ level }: { level: Level }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs" style={{ color: LEVEL_COLOR[level] }}>
      <span className="size-1.5 rounded-full" style={{ background: LEVEL_COLOR[level] }} />
      {LEVEL_LABEL[level]}
    </span>
  );
}

function UpNext({
  d,
  r,
  course,
  topicById,
  now,
  rolePlayer,
}: {
  d: MapDeadline;
  r: DeadlineReadiness;
  course?: MapCourse;
  topicById: Map<string, MapTopic>;
  now: Date;
  rolePlayer: boolean;
}) {
  const days = Math.max(0, Math.ceil((d.dueAt.getTime() - now.getTime()) / 864e5));
  const when = days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
  const nextTopic = r.next ? topicById.get(r.next.topicId) : undefined;
  const verdict =
    r.level === "ready"
      ? "Every topic it covers held up when you taught it. Keep it fresh with a short practice."
      : r.level === "not_ready"
        ? `${nextTopic?.name ?? "One topic"} didn't hold up yet. Teach it before the ${KIND_LABEL[d.kind].toLowerCase()}.`
        : r.level === "unmeasured"
          ? `Ready hasn't seen you explain ${nextTopic?.name ?? "these topics"} yet. A 10-minute session tells you where you stand.`
          : `Close. ${nextTopic?.name ?? "One topic"} is the shakiest part.`;
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">Up next · {when}</p>
          <h2 className="mt-1 text-lg font-semibold">{d.title}</h2>
          <p className="text-xs text-muted">{course?.displayCode ?? "Other"}</p>
        </div>
        <ReadinessChip level={r.level} />
      </div>
      <p className="text-sm">{verdict}</p>
      <ul className="flex flex-wrap gap-1.5">
        {r.topics.map((t) => (
          <li key={t.topicId} className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-xs">
            <span className="size-1.5 rounded-full" style={{ background: LEVEL_COLOR[t.level] }} />
            {topicById.get(t.topicId)?.name}
            {t.score !== null && <span className="text-muted">{t.score}</span>}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">
        {r.measured} of {r.topics.length} topics measured.
      </p>
      {nextTopic ? (
        <form action={startLessonAction} className="flex flex-wrap gap-2">
          <input type="hidden" name="topicId" value={nextTopic.id} />
          {rolePlayer && <input type="hidden" name="rolePlayer" value="on" />}
          <button className={buttonClass}>Teach {nextTopic.name}</button>
        </form>
      ) : (
        <form action={startLessonAction}>
          <input type="hidden" name="topicId" value={r.topics[0].topicId} />
          <input type="hidden" name="kind" value="practice" />
          <button className={secondaryButtonClass}>Practice {topicById.get(r.topics[0].topicId)?.name}</button>
        </form>
      )}
    </Card>
  );
}

function DeadlineRow({ d, course, tz, readiness }: { d: MapDeadline; course?: MapCourse; tz: string; readiness: DeadlineReadiness | null }) {
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
      {readiness && <ReadinessChip level={readiness.level} />}
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
