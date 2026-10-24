// All database access for Phase 1. Every query is scoped by student_id.
import { createHash } from "node:crypto";
import { sql } from "./index";
import { colorForIndex, normalizeCode, UNSORTED, type CourseRef, type DeadlineKind } from "@/lib/courses";
import type { Answers } from "@/lib/onboarding/flow";
import type { MaterialExtraction } from "@/lib/materials/schema";
import { localDateKey, zonedDate } from "@/lib/time";

export type Student = {
  id: string;
  email: string;
  school: string | null;
  major: string | null;
  year: string | null;
  timezone: string;
  phoneE164: string | null;
  onboardingAnswers: OnboardingState;
  onboardingDoneAt: Date | null;
};

export type OnboardingState = { answers: Answers; replies: Record<string, string> };

/** The jsonb column starts as {}; fill in the shape. */
export function onboardingState(student: Pick<Student, "onboardingAnswers">): OnboardingState {
  const raw = (student.onboardingAnswers ?? {}) as Partial<OnboardingState>;
  return { answers: raw.answers ?? {}, replies: raw.replies ?? {} };
}

const hash = (s: string) => createHash("sha256").update(s).digest("hex");

// ---- students --------------------------------------------------------------

export async function upsertStudentByEmail(email: string): Promise<Student> {
  const [s] = await sql<Student[]>`
    insert into students (email) values (${email.trim().toLowerCase()})
    on conflict (email) do update set email = excluded.email
    returning *`;
  return s;
}

export async function getStudent(id: string): Promise<Student | null> {
  const [s] = await sql<Student[]>`select * from students where id = ${id}`;
  return s ?? null;
}

export async function deleteStudent(id: string) {
  // Cascades to every row the student owns: goals, courses, deadlines, materials, consents.
  await sql`delete from students where id = ${id}`;
}

// ---- onboarding ------------------------------------------------------------

export async function saveOnboardingState(studentId: string, state: OnboardingState) {
  await sql`update students set onboarding_answers = ${sql.json(state as never)} where id = ${studentId}`;
}

/** Writes the normalized profile, goals and SMS consent once onboarding is complete. */
export async function completeOnboarding(studentId: string, a: Answers) {
  await sql.begin(async (tx) => {
    await tx`
      update students set
        school = ${a.school ?? null}, major = ${a.major ?? null}, year = ${a.year ?? null},
        study_time = ${a.studyTime ?? null}, session_length = ${a.sessionLength ?? null},
        text_window_start = ${a.textWindow?.start ?? null}, text_window_end = ${a.textWindow?.end ?? null},
        phone_e164 = ${a.phone ?? null}, onboarding_done_at = now()
      where id = ${studentId}`;
    await tx`delete from goals where student_id = ${studentId}`;
    for (const g of a.goals ?? []) {
      await tx`insert into goals (student_id, kind, label, target) values (${studentId}, ${g.kind}, ${g.label}, ${g.target ?? null})`;
    }
    if (a.smsConsent) {
      await tx`
        insert into consents (student_id, kind, granted, text_shown, source)
        values (${studentId}, 'sms', ${a.smsConsent.granted}, ${a.smsConsent.textShown}, 'web')`;
    }
  });
}

export async function getGoals(studentId: string) {
  return sql<{ kind: string; label: string }[]>`select kind, label from goals where student_id = ${studentId} order by created_at`;
}

// ---- consent ---------------------------------------------------------------

export async function currentConsent(studentId: string, kind: "sms" | "advisor_sharing") {
  const [row] = await sql<{ granted: boolean; createdAt: Date }[]>`
    select granted, created_at from consents where student_id = ${studentId} and kind = ${kind}
    order by created_at desc limit 1`;
  return row ?? null;
}

/** STOP / START by text. Returns false if the number isn't one of ours. */
export async function setSmsConsentByPhone(phone: string, granted: boolean, textShown: string): Promise<boolean> {
  const [s] = await sql<{ id: string }[]>`select id from students where phone_e164 = ${phone}`;
  if (!s) return false;
  await sql`insert into consents (student_id, kind, granted, text_shown, source) values (${s.id}, 'sms', ${granted}, ${textShown}, 'sms')`;
  return true;
}

// ---- courses ---------------------------------------------------------------

export async function getOrCreateCourse(studentId: string, ref: CourseRef | null): Promise<string> {
  const course = ref ?? UNSORTED;
  const code = normalizeCode(course.code) || UNSORTED.code;
  const [existing] = await sql<{ id: string; name: string | null }[]>`
    select id, name from courses where student_id = ${studentId} and code = ${code}`;
  if (existing) {
    if (!existing.name && course.name) await sql`update courses set name = ${course.name} where id = ${existing.id}`;
    return existing.id;
  }
  const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from courses where student_id = ${studentId}`;
  const [row] = await sql<{ id: string }[]>`
    insert into courses (student_id, code, display_code, name, color)
    values (${studentId}, ${code}, ${course.displayCode}, ${course.name}, ${colorForIndex(count)})
    on conflict (student_id, code) do update set code = excluded.code
    returning id`;
  return row.id;
}

// ---- deadlines -------------------------------------------------------------

export type NewDeadline = {
  uid: string;
  title: string;
  kind: DeadlineKind;
  dueAt: Date;
  allDay: boolean;
  course: CourseRef | null;
};

export type ImportCounts = { added: number; updated: number; duplicates: number };

export async function importDeadlines(
  student: Pick<Student, "id" | "timezone">,
  items: NewDeadline[],
  source: "ics" | "upload" | "manual",
  materialId: string | null = null,
): Promise<ImportCounts> {
  const counts: ImportCounts = { added: 0, updated: 0, duplicates: 0 };
  for (const item of items) {
    const courseId = await getOrCreateCourse(student.id, item.course);
    if (source !== "ics" && (await sameDayDuplicate(student, courseId, item))) {
      counts.duplicates++;
      continue;
    }
    const [row] = await sql<{ inserted: boolean }[]>`
      insert into deadlines (student_id, course_id, title, kind, due_at, all_day, source, external_uid, material_id)
      values (${student.id}, ${courseId}, ${item.title}, ${item.kind}, ${item.dueAt}, ${item.allDay}, ${source}, ${item.uid}, ${materialId})
      on conflict (student_id, source, external_uid) do update set
        title = excluded.title, kind = excluded.kind, due_at = excluded.due_at,
        all_day = excluded.all_day, course_id = excluded.course_id
      returning (xmax = 0) as inserted`;
    if (row.inserted) counts.added++;
    else counts.updated++;
  }
  return counts;
}

/** A syllabus often repeats what the calendar already has; skip same course + day + kind. */
async function sameDayDuplicate(student: Pick<Student, "id" | "timezone">, courseId: string, item: NewDeadline) {
  const day = localDateKey(item.dueAt, student.timezone);
  const rows = await sql<{ dueAt: Date; externalUid: string }[]>`
    select due_at, external_uid from deadlines
    where student_id = ${student.id} and course_id = ${courseId} and kind = ${item.kind}
      and due_at between ${new Date(item.dueAt.getTime() - 864e5)} and ${new Date(item.dueAt.getTime() + 864e5)}`;
  return rows.some((r) => r.externalUid !== item.uid && localDateKey(r.dueAt, student.timezone) === day);
}

export function extractionToDeadlines(x: MaterialExtraction, tz: string): NewDeadline[] {
  const course = courseFromExtraction(x);
  return x.deadlines
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date))
    .map((d) => ({
      uid: hash(`${course?.code ?? ""}|${d.date}|${d.title.toLowerCase()}`).slice(0, 32),
      title: d.title,
      kind: d.kind,
      dueAt: zonedDate(d.date, d.time && /^\d{2}:\d{2}$/.test(d.time) ? d.time : null, tz),
      allDay: !d.time,
      course,
    }));
}

export function courseFromExtraction(x: MaterialExtraction): CourseRef | null {
  if (!x.course.code && !x.course.name) return null;
  const code = x.course.code ? normalizeCode(x.course.code) : normalizeCode(x.course.name!).slice(0, 12);
  return { code, displayCode: x.course.code ?? x.course.name!, name: x.course.name };
}

export async function addManualDeadline(
  student: Pick<Student, "id" | "timezone">,
  input: { courseId: string; title: string; kind: DeadlineKind; date: string; time: string | null },
) {
  const [course] = await sql<{ id: string }[]>`select id from courses where id = ${input.courseId} and student_id = ${student.id}`;
  if (!course) throw new Error("Unknown course");
  await sql`
    insert into deadlines (student_id, course_id, title, kind, due_at, all_day, source, external_uid)
    values (${student.id}, ${course.id}, ${input.title}, ${input.kind}, ${zonedDate(input.date, input.time, student.timezone)},
            ${!input.time}, 'manual', ${crypto.randomUUID()})`;
}

// ---- calendar feeds --------------------------------------------------------

export async function recordFeedSync(studentId: string, url: string, error: string | null) {
  await sql`
    insert into calendar_feeds (student_id, url, last_synced_at, last_error)
    values (${studentId}, ${url}, ${error ? null : new Date()}, ${error})
    on conflict (student_id, url) do update set
      last_synced_at = coalesce(excluded.last_synced_at, calendar_feeds.last_synced_at),
      last_error = excluded.last_error`;
}

// ---- materials & topics ----------------------------------------------------

export async function saveMaterial(
  studentId: string,
  m: { filename: string; mime: string; kind: "syllabus" | "slides" | "screenshot" | "other"; text: string; contentHash: string; courseId: string | null },
): Promise<{ id: string; isNew: boolean }> {
  const [row] = await sql<{ id: string; inserted: boolean }[]>`
    insert into materials (student_id, course_id, filename, mime, kind, extracted_text, sha256)
    values (${studentId}, ${m.courseId}, ${m.filename}, ${m.mime}, ${m.kind}, ${m.text}, ${m.contentHash})
    on conflict (student_id, sha256) do update set filename = excluded.filename
    returning id, (xmax = 0) as inserted`;
  return { id: row.id, isNew: row.inserted };
}

export async function saveTopics(studentId: string, courseId: string, topics: MaterialExtraction["topics"], materialId: string) {
  const [{ max }] = await sql<{ max: number }[]>`select coalesce(max(position), -1)::int as max from topics where course_id = ${courseId}`;
  const ids = new Map<string, string>();
  let position = max + 1;
  for (const t of topics) {
    const name = t.name.trim();
    if (!name) continue;
    const [row] = await sql<{ id: string }[]>`
      insert into topics (student_id, course_id, name, position, material_id)
      values (${studentId}, ${courseId}, ${name}, ${position++}, ${materialId})
      on conflict (course_id, lower(name)) do update set name = topics.name
      returning id`;
    ids.set(name.toLowerCase(), row.id);
  }
  for (const t of topics) {
    const id = ids.get(t.name.trim().toLowerCase());
    for (const p of t.prerequisites) {
      const pid = ids.get(p.trim().toLowerCase());
      if (id && pid && id !== pid) {
        await sql`insert into topic_prerequisites (topic_id, prerequisite_id) values (${id}, ${pid}) on conflict do nothing`;
      }
    }
  }
  return ids.size;
}

export const contentHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

// ---- semester map ----------------------------------------------------------

export type MapCourse = { id: string; displayCode: string; name: string | null; color: string };
export type MapDeadline = { id: string; courseId: string | null; title: string; kind: DeadlineKind; dueAt: Date; allDay: boolean; source: string };
export type MapTopic = { id: string; courseId: string; name: string; prerequisites: string[] };

export async function semesterMap(studentId: string) {
  const [courses, deadlines, topics, materials] = await Promise.all([
    sql<MapCourse[]>`select id, display_code, name, color from courses where student_id = ${studentId} order by display_code`,
    sql<MapDeadline[]>`select id, course_id, title, kind, due_at, all_day, source from deadlines where student_id = ${studentId} order by due_at`,
    sql<MapTopic[]>`
      select t.id, t.course_id, t.name,
        coalesce(array_agg(p.name order by p.position) filter (where p.id is not null), '{}') as prerequisites
      from topics t
      left join topic_prerequisites tp on tp.topic_id = t.id
      left join topics p on p.id = tp.prerequisite_id
      where t.student_id = ${studentId}
      group by t.id order by t.position`,
    sql<{ count: number }[]>`select count(*)::int as count from materials where student_id = ${studentId}`,
  ]);
  return { courses, deadlines, topics, materialCount: materials[0].count };
}
