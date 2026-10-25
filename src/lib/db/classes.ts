// Instructors, classes, and per-class sharing consent. An instructor can only
// ever read students whose latest consent row for that class says granted.
import { sql } from "./index";
import { normalizeCode } from "@/lib/courses";
import { makeJoinCode, sharingConsentText, type MemberData } from "@/lib/classes/report";
import type { Evidence } from "@/lib/readiness";

export type Faculty = { id: string; email: string; displayName: string; school: string | null };

// ---- faculty -----------------------------------------------------------------

export async function createFaculty(email: string, displayName: string, passwordHash: string, school: string | null): Promise<Faculty | null> {
  const [row] = await sql<Faculty[]>`
    insert into faculty (email, display_name, password_hash, school)
    values (${email.trim().toLowerCase()}, ${displayName.trim()}, ${passwordHash}, ${school?.trim() || null})
    on conflict (email) do nothing
    returning id, email, display_name, school`;
  return row ?? null;
}

export async function facultyAuthByEmail(email: string) {
  const [row] = await sql<{ id: string; passwordHash: string }[]>`select id, password_hash from faculty where email = ${email.trim().toLowerCase()}`;
  return row ?? null;
}

export async function getFaculty(id: string): Promise<Faculty | null> {
  const [row] = await sql<Faculty[]>`select id, email, display_name, school from faculty where id = ${id}`;
  return row ?? null;
}

// ---- classes -----------------------------------------------------------------

export type ClassRow = { id: string; facultyId: string; name: string; courseCode: string; displayCode: string; joinCode: string; createdAt: Date };

export async function createClass(facultyId: string, name: string, displayCode: string): Promise<ClassRow> {
  const code = normalizeCode(displayCode);
  // Join codes are random; retry on the rare collision.
  for (let attempt = 0; ; attempt++) {
    const [row] = await sql<ClassRow[]>`
      insert into classes (faculty_id, name, course_code, display_code, join_code)
      values (${facultyId}, ${name.trim()}, ${code}, ${displayCode.trim().toUpperCase()}, ${makeJoinCode(displayCode)})
      on conflict (join_code) do nothing
      returning *`;
    if (row) return row;
    if (attempt > 5) throw new Error("Couldn't make a join code. Try again.");
  }
}

export type ClassSummary = ClassRow & { members: number; sharing: number };

export async function facultyClasses(facultyId: string): Promise<ClassSummary[]> {
  return sql<ClassSummary[]>`
    select c.*, count(cm.student_id)::int as members,
      count(cm.student_id) filter (where ${sharingNow(sql`cm.student_id`, sql`c.id`)})::int as sharing
    from classes c left join class_members cm on cm.class_id = c.id
    where c.faculty_id = ${facultyId}
    group by c.id order by c.created_at desc`;
}

export async function facultyClass(facultyId: string, classId: string): Promise<ClassRow | null> {
  const [row] = await sql<ClassRow[]>`select * from classes where id = ${classId} and faculty_id = ${facultyId}`;
  return row ?? null;
}

export async function classByJoinCode(joinCode: string) {
  const [row] = await sql<(ClassRow & { instructor: string })[]>`
    select c.*, f.display_name as instructor from classes c join faculty f on f.id = c.faculty_id
    where c.join_code = ${joinCode.trim().toUpperCase()}`;
  return row ?? null;
}

// ---- sharing -------------------------------------------------------------------

/** True when the latest sharing consent for (student, class) is granted. */
const sharingNow = (studentId: ReturnType<typeof sql>, classId: ReturnType<typeof sql>) => sql`
  coalesce((select granted from consents k where k.student_id = ${studentId} and k.class_id = ${classId}
            and k.kind = 'advisor_sharing' order by k.created_at desc limit 1), false)`;

/** Joins (or rejoins) a class and records the exact consent wording the student agreed to. */
export async function joinClass(studentId: string, classId: string) {
  const cls = await classWithInstructor(classId);
  if (!cls) throw new Error("That class doesn't exist anymore.");
  await sql.begin(async (tx) => {
    await tx`insert into class_members (class_id, student_id) values (${classId}, ${studentId}) on conflict do nothing`;
    await tx`
      insert into consents (student_id, kind, granted, text_shown, source, class_id)
      values (${studentId}, 'advisor_sharing', true, ${sharingConsentText(cls.instructor, classLabel(cls))}, 'web', ${classId})`;
  });
}

export async function stopSharing(studentId: string, classId: string) {
  const cls = await classWithInstructor(classId);
  if (!cls) return;
  await sql`
    insert into consents (student_id, kind, granted, text_shown, source, class_id)
    values (${studentId}, 'advisor_sharing', false, ${`Stopped sharing ${classLabel(cls)} with ${cls.instructor}.`}, 'web', ${classId})`;
}

async function classWithInstructor(classId: string) {
  const [row] = await sql<(ClassRow & { instructor: string })[]>`
    select c.*, f.display_name as instructor from classes c join faculty f on f.id = c.faculty_id where c.id = ${classId}`;
  return row ?? null;
}

export const classLabel = (c: { name: string; displayCode: string }) => (c.name.includes(c.displayCode) ? c.name : `${c.displayCode} · ${c.name}`);

export async function studentClasses(studentId: string) {
  return sql<{ id: string; name: string; displayCode: string; joinCode: string; instructor: string; sharing: boolean }[]>`
    select c.id, c.name, c.display_code, c.join_code, f.display_name as instructor, ${sharingNow(sql`cm.student_id`, sql`c.id`)} as sharing
    from class_members cm join classes c on c.id = cm.class_id join faculty f on f.id = c.faculty_id
    where cm.student_id = ${studentId} order by cm.joined_at`;
}

// ---- the dashboard's data ---------------------------------------------------------

/**
 * Everything the report needs for the students sharing right now, limited to the
 * class's course. Notes, transcripts and answers are never read here.
 */
export async function classMembers(classId: string): Promise<{ members: MemberData[]; notSharing: number }> {
  const [cls] = await sql<{ courseCode: string }[]>`select course_code from classes where id = ${classId}`;
  if (!cls) return { members: [], notSharing: 0 };
  const roster = await sql<{ studentId: string; displayName: string | null; email: string; sharing: boolean }[]>`
    select cm.student_id, s.display_name, s.email, ${sharingNow(sql`cm.student_id`, sql`cm.class_id`)} as sharing
    from class_members cm join students s on s.id = cm.student_id
    where cm.class_id = ${classId}`;
  const ids = roster.filter((r) => r.sharing).map((r) => r.studentId);
  if (ids.length === 0) return { members: [], notSharing: roster.length };

  const [topics, deadlines, evidence, activity] = await Promise.all([
    sql<{ id: string; studentId: string; courseId: string; name: string; position: number; prerequisites: string[] }[]>`
      select t.id, t.student_id, t.course_id, t.name, t.position,
        coalesce(array_agg(p.name) filter (where p.id is not null), '{}') as prerequisites
      from topics t join courses c on c.id = t.course_id
      left join topic_prerequisites tp on tp.topic_id = t.id
      left join topics p on p.id = tp.prerequisite_id
      where t.student_id = any(${ids}::uuid[]) and c.code = ${cls.courseCode}
      group by t.id`,
    sql<{ id: string; studentId: string; courseId: string; title: string; kind: "exam" | "quiz" | "assignment" | "other"; dueAt: Date }[]>`
      select d.id, d.student_id, d.course_id, d.title, d.kind, d.due_at from deadlines d join courses c on c.id = d.course_id
      where d.student_id = any(${ids}::uuid[]) and c.code = ${cls.courseCode}`,
    sql<(Evidence & { studentId: string })[]>`
      select ts.student_id, ts.topic_id, ts.source, ts.score, ts.confident_wrong, ts.created_at
      from topic_scores ts join topics t on t.id = ts.topic_id join courses c on c.id = t.course_id
      where ts.student_id = any(${ids}::uuid[]) and c.code = ${cls.courseCode} and ts.created_at > now() - interval '120 days'`,
    sql<{ studentId: string; lastActive: Date | null }[]>`
      select s.id as student_id, greatest(
        (select max(started_at) from sessions where student_id = s.id),
        (select max(created_at) from topic_scores where student_id = s.id)) as last_active
      from students s where s.id = any(${ids}::uuid[])`,
  ]);
  const last = new Map(activity.map((a) => [a.studentId, a.lastActive]));
  const members: MemberData[] = roster
    .filter((r) => r.sharing)
    .map((r) => ({
      studentId: r.studentId,
      name: r.displayName?.trim() || r.email.split("@")[0],
      lastActive: last.get(r.studentId) ?? null,
      topics: topics.filter((t) => t.studentId === r.studentId),
      deadlines: deadlines.filter((d) => d.studentId === r.studentId),
      evidence: evidence.filter((e) => e.studentId === r.studentId),
    }));
  return { members, notSharing: roster.length - ids.length };
}
