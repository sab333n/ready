// The nudge loop's I/O: gathers what planNudge needs, sends by push (free) or
// text, and logs every message.
import { sql } from "@/lib/db";
import { createLoginLink } from "@/lib/auth/links";
import { env } from "@/lib/env";
import { sendPush } from "@/lib/push/send";
import { studentEvidence } from "@/lib/db/lessons";
import { currentConsent, semesterMap } from "@/lib/db/repo";
import { deadlineReadiness, deadlineTopics, topicReadiness } from "@/lib/readiness";
import { DAILY_CAP, NOTHING_DUE_REPLY, nudgePush, nudgeText, planNudge, sentToday, type Channel, type NudgeCandidate, type NudgeContext, type NudgePlan } from "./nudge";
import { sendSms } from "./send";

type Kind = "nudge" | "instructor" | "test" | "reply" | "snooze" | "other";

export async function logSms(
  studentId: string,
  m: {
    direction: "out" | "in";
    kind: Kind;
    body: string;
    status: "sent" | "dry_run" | "failed" | "received";
    channel?: Channel;
    error?: string;
    providerId?: string;
    deadlineId?: string | null;
    topicId?: string | null;
  },
) {
  await sql`
    insert into sms_messages (student_id, direction, kind, body, status, channel, error, provider_id, deadline_id, topic_id)
    values (${studentId}, ${m.direction}, ${m.kind}, ${m.body}, ${m.status}, ${m.channel ?? "sms"}, ${m.error ?? null}, ${m.providerId ?? null},
            ${m.deadlineId ?? null}, ${m.topicId ?? null})`;
}

/** Notifies every device the student allowed, forgets expired ones, and logs one row. */
export async function pushStudent(
  studentId: string,
  note: { title: string; body: string; url: string; laterUrl?: string | null },
  meta: { kind: Kind; deadlineId?: string | null; topicId?: string | null },
) {
  const subs = await sql<{ id: string; endpoint: string; p256dh: string; auth: string }[]>`
    select id, endpoint, p256dh, auth from push_subscriptions where student_id = ${studentId}`;
  const results = await Promise.all(subs.map((sub) => sendPush(sub, { ...note, tag: meta.topicId ?? "ready" })));
  const gone = subs.filter((_, i) => results[i].status === "gone").map((s) => s.id);
  if (gone.length) await sql`delete from push_subscriptions where id = any(${gone}::uuid[])`;
  const status = results.some((r) => r.status === "sent") ? "sent" : results.some((r) => r.status === "dry_run") ? "dry_run" : "failed";
  const error = status === "failed" ? (results.find((r) => r.error)?.error ?? "No device accepted the notification") : undefined;
  await logSms(studentId, { direction: "out", channel: "push", body: `${note.title}. ${note.body}`, status, error, ...meta });
  return { status, error } as const;
}

/** Sends and logs one text. */
export async function textStudent(studentId: string, phone: string, body: string, meta: { kind: Kind; deadlineId?: string | null; topicId?: string | null }) {
  const result = await sendSms(phone, body);
  await logSms(studentId, { direction: "out", body, ...meta, ...result });
  return result;
}

type StudentRow = { id: string; timezone: string; phoneE164: string | null; textWindowStart: number | null; textWindowEnd: number | null };

async function studentRow(studentId: string) {
  const [s] = await sql<StudentRow[]>`select id, timezone, phone_e164, text_window_start, text_window_end from students where id = ${studentId}`;
  return s ?? null;
}

export async function nudgeContext(s: StudentRow, now = new Date()): Promise<NudgeContext> {
  const [{ deadlines, topics }, evidence, consent, [{ devices }], recent, snooze] = await Promise.all([
    semesterMap(s.id),
    studentEvidence(s.id),
    currentConsent(s.id, "sms"),
    sql<{ devices: number }[]>`select count(*)::int as devices from push_subscriptions where student_id = ${s.id}`,
    sql<{ kind: string; deadlineId: string | null; topicId: string | null; at: Date }[]>`
      select kind, deadline_id, topic_id, created_at as at from sms_messages
      where student_id = ${s.id} and direction = 'out' and kind in ('nudge', 'instructor', 'test') and created_at > ${new Date(now.getTime() - 864e5)}`,
    sql<{ at: Date }[]>`
      select created_at as at from sms_messages where student_id = ${s.id} and direction = 'in' and kind = 'snooze'
      order by created_at desc limit 1`,
  ]);
  const byTopic = new Map(topics.map((t) => [t.id, topicReadiness(t.id, evidence, now)]));
  const names = new Map(topics.map((t) => [t.id, t.name]));
  const candidates: NudgeCandidate[] = [];
  for (const d of deadlines) {
    if (d.dueAt <= now) continue;
    const readiness = deadlineReadiness(deadlineTopics(d, topics), byTopic);
    if (!readiness) continue;
    const topicId = readiness.next?.topicId ?? null;
    candidates.push({ deadline: d, readiness, topicId, topicName: topicId ? names.get(topicId) ?? null : null });
  }
  return {
    now,
    timezone: s.timezone,
    // Push is free and instant, so it wins when the student allowed notifications on a device.
    channel: devices > 0 ? "push" : s.phoneE164 && consent?.granted ? "sms" : null,
    // Students who skipped texting hours get daytime-to-evening by default.
    window: s.textWindowStart !== null && s.textWindowEnd !== null ? { start: s.textWindowStart, end: s.textWindowEnd } : { start: 9, end: 21 },
    recent,
    snoozedUntil: snooze[0] ? new Date(snooze[0].at.getTime() + 20 * 3600_000) : null,
    candidates,
  };
}

export type NudgeOutcome = { sent: boolean; reason?: string; body?: string; status?: string; error?: string; channel?: Channel };

/**
 * Texts a student about their nearest test they aren't ready for.
 *   cron:        respects their hours, snooze, cap and repeats
 *   instructor:  an instructor pressed "Send a nudge"; ignores the hour window, still capped
 *   test:        the student pressed "Text me now"; says so when nothing is due
 */
export async function nudgeStudent(studentId: string, how: { kind: "nudge" } | { kind: "instructor"; from: string } | { kind: "test" }, now = new Date()): Promise<NudgeOutcome> {
  const s = await studentRow(studentId);
  if (!s) return { sent: false, reason: "No such student" };
  const ctx = await nudgeContext(s, now);
  const manual = how.kind !== "nudge";
  const plan: NudgePlan = planNudge(ctx, { ignoreWindow: manual, ignoreSnooze: how.kind === "test" });
  if (!plan.send) {
    if (how.kind === "test" && ctx.channel && plan.reason === "Ready for everything this week") {
      const r =
        ctx.channel === "push"
          ? await pushStudent(s.id, { title: "You're on track", body: NOTHING_DUE_REPLY, url: `${env.appUrl}/map` }, { kind: "test" })
          : await textStudent(s.id, s.phoneE164!, `Ready: ${NOTHING_DUE_REPLY}`, { kind: "test" });
      return { sent: r.status !== "failed", body: NOTHING_DUE_REPLY, status: r.status, error: r.error, channel: ctx.channel };
    }
    return { sent: false, reason: plan.reason };
  }
  const c = plan.candidate;
  const link = await createLoginLink(s.id, c.topicId, now);
  const from = how.kind === "instructor" ? how.from : undefined;
  const meta = { kind: how.kind, deadlineId: c.deadline.id, topicId: c.topicId };
  if (ctx.channel === "push") {
    const note = nudgePush(c, now, s.timezone, from);
    const laterUrl = `${env.appUrl}/api/push/later/${link.split("/t/")[1]}`;
    const r = await pushStudent(s.id, { ...note, url: link, laterUrl }, meta);
    return { sent: r.status !== "failed", body: `${note.title}. ${note.body}`, status: r.status, error: r.error, channel: "push" };
  }
  const body = nudgeText(c, now, s.timezone, link, from);
  const r = await textStudent(s.id, s.phoneE164!, body, meta);
  return { sent: r.status !== "failed", body, status: r.status, error: r.error, channel: "sms" };
}

/** The daily job: every student who allowed notifications or texts, inside their hours. */
export async function runNudges(now = new Date()) {
  const rows = await sql<{ id: string }[]>`
    select s.id from students s
    where s.onboarding_done_at is not null and (
      exists (select 1 from push_subscriptions p where p.student_id = s.id)
      or (s.phone_e164 is not null
          and coalesce((select granted from consents c where c.student_id = s.id and c.kind = 'sms' order by c.created_at desc limit 1), false)))`;
  const summary = { checked: rows.length, sent: 0, skipped: {} as Record<string, number> };
  for (const row of rows) {
    const out = await nudgeStudent(row.id, { kind: "nudge" }, now).catch((err) => ({ sent: false, reason: `Error: ${err instanceof Error ? err.message : err}` }));
    if (out.sent) summary.sent++;
    else summary.skipped[out.reason ?? "failed"] = (summary.skipped[out.reason ?? "failed"] ?? 0) + 1;
  }
  return summary;
}

/** The newest nudge's topic, for a "YES" reply. */
export async function lastNudgedTopic(studentId: string) {
  const [row] = await sql<{ topicId: string | null; name: string | null }[]>`
    select m.topic_id, t.name from sms_messages m left join topics t on t.id = m.topic_id
    where m.student_id = ${studentId} and m.direction = 'out' and m.topic_id is not null
    order by m.created_at desc limit 1`;
  return row ?? null;
}

export async function recentTexts(studentId: string, limit = 5) {
  return sql<{ direction: "out" | "in"; kind: string; body: string; status: string; channel: Channel; createdAt: Date }[]>`
    select direction, kind, body, status, channel, created_at from sms_messages where student_id = ${studentId}
    order by created_at desc limit ${limit}`;
}

export async function studentByPhone(phone: string) {
  const [row] = await sql<{ id: string }[]>`select id from students where phone_e164 = ${phone}`;
  return row ?? null;
}

// ---- push subscriptions -------------------------------------------------------------

export async function savePushSubscription(studentId: string, sub: { endpoint: string; p256dh: string; auth: string }, userAgent: string | null) {
  await sql`
    insert into push_subscriptions (student_id, endpoint, p256dh, auth, user_agent)
    values (${studentId}, ${sub.endpoint}, ${sub.p256dh}, ${sub.auth}, ${userAgent})
    on conflict (endpoint) do update set student_id = excluded.student_id, p256dh = excluded.p256dh, auth = excluded.auth`;
}

export async function removePushSubscriptions(studentId: string, endpoint?: string) {
  if (endpoint) await sql`delete from push_subscriptions where student_id = ${studentId} and endpoint = ${endpoint}`;
  else await sql`delete from push_subscriptions where student_id = ${studentId}`;
}

export async function pushDeviceCount(studentId: string) {
  const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from push_subscriptions where student_id = ${studentId}`;
  return count;
}

/**
 * A one-off message from an instructor (e.g. "I made you a video"), with a link
 * that opens `path`. Same channel and daily cap as nudges.
 */
export async function notifyStudent(studentId: string, msg: { title: string; body: string; path: string }, now = new Date()): Promise<NudgeOutcome> {
  const s = await studentRow(studentId);
  if (!s) return { sent: false, reason: "No such student" };
  const ctx = await nudgeContext(s, now);
  if (!ctx.channel) return { sent: false, reason: "Hasn't turned on reminders" };
  if (sentToday(ctx) >= DAILY_CAP) return { sent: false, reason: `Already nudged ${DAILY_CAP} times today` };
  const link = await createLoginLink(s.id, null, now, msg.path);
  const r =
    ctx.channel === "push"
      ? await pushStudent(s.id, { title: msg.title, body: msg.body, url: link }, { kind: "instructor" })
      : await textStudent(s.id, s.phoneE164!, `${msg.title}. ${msg.body} ${link} Reply STOP to opt out.`, { kind: "instructor" });
  return { sent: r.status !== "failed", status: r.status, error: r.error, channel: ctx.channel };
}
