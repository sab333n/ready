import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentFaculty } from "@/lib/auth/faculty";
import { classLabel, classMembers, facultyClass } from "@/lib/db/classes";
import { classReport, type ClassReport, type ClassTopic, type MemberRow } from "@/lib/classes/report";
import { LEVEL_LABEL, LEVEL_ORDER, type Level } from "@/lib/readiness";

export default function ClassDashboard(props: PageProps<"/faculty/class/[id]">) {
  return (
    <Suspense fallback={<p className="p-8 text-[#5a5a5a]">Loading the class…</p>}>
      <Dashboard params={props.params} />
    </Suspense>
  );
}

// Light-background versions of the app's readiness colors.
const COLOR: Record<Level, string> = { not_ready: "#dc2626", unmeasured: "#a3a3a3", getting_there: "#d97706", ready: "#16a34a" };
const TINT: Record<Level, string> = { not_ready: "#fde2e2", unmeasured: "#f4f4f3", getting_there: "#fdefd9", ready: "#dcf3e3" };

async function Dashboard({ params }: { params: PageProps<"/faculty/class/[id]">["params"] }) {
  const faculty = await currentFaculty();
  if (!faculty) redirect("/faculty");
  const { id } = await params;
  const cls = await facultyClass(faculty.id, id).catch(() => null);
  if (!cls) notFound();
  const { members, notSharing } = await classMembers(cls.id);
  const now = new Date();
  const report = classReport(members, now);

  return (
    <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-6 px-5 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/faculty" className="text-sm text-[#5a5a5a] hover:text-[#111]">
            ← Your classes
          </Link>
          <h1 className="mt-1 text-3xl font-semibold tracking-[-0.04em]">{classLabel(cls)}</h1>
          <p className="text-[#5a5a5a]">
            {members.length} {members.length === 1 ? "student" : "students"} sharing
            {notSharing > 0 ? ` · ${notSharing} joined but not sharing` : ""}
          </p>
        </div>
        <div className="rounded-2xl border border-black/8 px-4 py-3 text-sm">
          <p className="text-[#5a5a5a]">Students join with</p>
          <p className="font-mono text-xl font-semibold tracking-wider">{cls.joinCode}</p>
          <p className="text-xs text-[#5a5a5a]">Semester page → Share with an instructor</p>
        </div>
      </div>

      {members.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-black/15 p-8 text-center">
          <p className="text-lg font-semibold">No one is sharing yet.</p>
          <p className="mx-auto mt-2 max-w-lg text-[#5a5a5a]">
            Put the code <span className="font-mono text-[#111]">{cls.joinCode}</span> on a slide or in Canvas. Each student sees exactly what you&apos;ll see before they
            agree, and only their readiness for {cls.displayCode} is shared.
          </p>
        </section>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
            <NextTest report={report} now={now} total={members.length} />
            <Misconceptions topics={report.topics} />
          </div>
          <AtRiskList report={report} />
          <Heatmap report={report} now={now} />
          <p className="text-xs text-[#5a5a5a]">
            Readiness comes from what students explained to Ready&apos;s AI students, their probe answers and teach-backs, weighted toward the last two weeks. Students
            see the same numbers you do.
          </p>
        </>
      )}
    </main>
  );
}

function NextTest({ report, now, total }: { report: ClassReport; now: Date; total: number }) {
  const exam = report.exam;
  if (!exam) {
    return (
      <section className="rounded-2xl border border-black/8 p-5">
        <p className="text-xs font-semibold tracking-wide text-[#5a5a5a] uppercase">Next test</p>
        <p className="mt-2 text-[#5a5a5a]">No exam or quiz in the next 30 days on students&apos; calendars.</p>
      </section>
    );
  }
  const days = Math.max(0, Math.ceil((exam.dueAt.getTime() - now.getTime()) / 864e5));
  const date = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Chicago" }).format(exam.dueAt);
  const notReady = exam.counts.not_ready + exam.counts.unmeasured;
  return (
    <section className="rounded-2xl border border-black/8 p-5">
      <p className="text-xs font-semibold tracking-wide text-[#5a5a5a] uppercase">
        Next {exam.kind} · {date} · {days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`}
      </p>
      <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em]">{exam.title}</h2>
      <p className="mt-1 text-[#111]">
        <span className="text-3xl font-semibold">{exam.counts.ready}</span> <span className="text-[#5a5a5a]">of {total} ready</span>
        {notReady > 0 && <span className="text-[#5a5a5a]"> · {notReady} not ready or not measured</span>}
      </p>
      <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-[#f4f4f3]" role="img" aria-label="Class readiness for the next test">
        {(["ready", "getting_there", "unmeasured", "not_ready"] as Level[]).map((level) =>
          exam.counts[level] ? <div key={level} style={{ width: `${(100 * exam.counts[level]) / total}%`, background: COLOR[level] }} /> : null,
        )}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {(["ready", "getting_there", "unmeasured", "not_ready"] as Level[]).map((level) => (
          <li key={level} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ background: COLOR[level] }} />
            {LEVEL_LABEL[level]} <span className="text-[#5a5a5a]">{exam.counts[level]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Misconceptions({ topics }: { topics: ClassTopic[] }) {
  const hot = topics
    .filter((t) => t.confidentWrong > 0 || (t.average !== null && t.average < 60 && t.measured >= 2))
    .sort((a, b) => b.confidentWrong - a.confidentWrong || (a.average ?? 100) - (b.average ?? 100))
    .slice(0, 4);
  return (
    <section className="rounded-2xl border border-black/8 p-5">
      <p className="text-xs font-semibold tracking-wide text-[#5a5a5a] uppercase">Worth class time</p>
      {hot.length === 0 ? (
        <p className="mt-2 text-[#5a5a5a]">No topic stands out yet. This fills in as students teach.</p>
      ) : (
        <ul className="mt-2 flex flex-col divide-y divide-black/6">
          {hot.map((t) => (
            <li key={t.key} className="py-2.5">
              <p className="font-medium">{t.name}</p>
              <p className="text-sm text-[#5a5a5a]">
                {t.confidentWrong > 0 && (
                  <span className="text-[#dc2626]">
                    {t.confidentWrong} sure but wrong ·{" "}
                  </span>
                )}
                class average {t.average ?? "—"} · {t.notReady} of {t.students} not ready
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AtRiskList({ report }: { report: ClassReport }) {
  return (
    <section className="rounded-2xl border border-black/8 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">Needs attention</h2>
        <p className="text-sm text-[#5a5a5a]">{report.atRisk.length === 0 ? "Nobody right now" : `${report.atRisk.length} students`}</p>
      </div>
      {report.atRisk.length > 0 && (
        <ul className="mt-3 grid gap-2 md:grid-cols-2">
          {report.atRisk.map((r) => (
            <li key={r.studentId} className="rounded-xl border border-black/8 p-3" style={{ borderLeft: `4px solid ${r.severity >= 3 ? COLOR.not_ready : COLOR.getting_there}` }}>
              <p className="font-medium">{r.name}</p>
              <ul className="mt-1 text-sm text-[#3a3a3a]">
                {r.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              {r.teachNext && <p className="mt-1.5 text-xs text-[#5a5a5a]">Their semester page suggests teaching {r.teachNext} next.</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Heatmap({ report, now }: { report: ClassReport; now: Date }) {
  const rank = (r: MemberRow) => (r.exam ? LEVEL_ORDER.indexOf(r.exam.level) : 4);
  const rows = [...report.rows].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  return (
    <section className="rounded-2xl border border-black/8 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">Readiness by topic</h2>
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[#5a5a5a]">
          {(["ready", "getting_there", "not_ready", "unmeasured"] as Level[]).map((level) => (
            <li key={level} className="flex items-center gap-1">
              <span className="size-2.5 rounded-sm" style={{ background: TINT[level], outline: `1px solid ${COLOR[level]}` }} />
              {LEVEL_LABEL[level]}
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-separate border-spacing-1 text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-white px-2 text-left font-medium text-[#5a5a5a]">Student</th>
              {report.exam && <th className="px-1 text-left text-xs font-medium text-[#5a5a5a]">Next test</th>}
              {report.topics.map((t) => (
                <th key={t.key} className="min-w-20 px-1 text-left align-bottom text-xs leading-tight font-medium text-[#5a5a5a]" title={t.name}>
                  {t.name}
                </th>
              ))}
              <th className="px-1 text-left text-xs font-medium text-[#5a5a5a]">Last studied</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.studentId}>
                <td className="sticky left-0 z-10 truncate bg-white px-2 py-1 font-medium whitespace-nowrap">{r.name}</td>
                {report.exam && (
                  <td className="px-1">
                    {r.exam ? (
                      <span className="inline-flex items-center gap-1 text-xs whitespace-nowrap" style={{ color: COLOR[r.exam.level] }}>
                        <span className="size-2 rounded-full" style={{ background: COLOR[r.exam.level] }} />
                        {LEVEL_LABEL[r.exam.level]}
                      </span>
                    ) : (
                      <span className="text-xs text-[#a3a3a3]">—</span>
                    )}
                  </td>
                )}
                {report.topics.map((t) => {
                  const cell = r.cells[t.key];
                  if (!cell) return <td key={t.key} className="rounded-md bg-[#fafafa]" />;
                  return (
                    <td
                      key={t.key}
                      className="rounded-md px-2 py-1.5 text-center text-xs font-medium tabular-nums"
                      style={{ background: TINT[cell.level], color: COLOR[cell.level] }}
                      title={`${t.name}: ${LEVEL_LABEL[cell.level]}${cell.score !== null ? ` (${cell.score})` : ""}`}
                    >
                      {cell.score ?? "·"}
                    </td>
                  );
                })}
                <td className="px-1 text-xs whitespace-nowrap text-[#5a5a5a]">{r.lastActive ? ago(r.lastActive, now) : "never"}</td>
              </tr>
            ))}
            <tr>
              <td className="sticky left-0 z-10 bg-white px-2 pt-2 text-xs font-semibold text-[#5a5a5a] uppercase">Class average</td>
              {report.exam && <td />}
              {report.topics.map((t) => (
                <td key={t.key} className="px-2 pt-2 text-center text-xs font-semibold tabular-nums">
                  {t.average ?? "—"}
                </td>
              ))}
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ago(when: Date, now: Date) {
  const days = Math.floor((now.getTime() - when.getTime()) / 864e5);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}
