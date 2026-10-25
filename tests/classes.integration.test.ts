// Instructor dashboard: only students whose latest consent is "share" are
// visible, only for the class's course, and stopping takes effect at once.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { upsertStudentByEmail } from "@/lib/db/repo";
import { classByJoinCode, classMembers, createClass, createFaculty, facultyClasses, joinClass, stopSharing, studentClasses } from "@/lib/db/classes";
import { classReport } from "@/lib/classes/report";
import { migrate } from "../scripts/migrate";
import { seedDemo } from "../scripts/seed-demo";

beforeAll(async () => {
  await migrate(process.env.DATABASE_URL!, { log: false });
});

beforeEach(async () => {
  await sql`truncate students, faculty cascade`;
});

afterAll(async () => {
  await sql.end();
});

async function studentWithCourse(email: string, code: string, topic: string, score: number) {
  const s = await upsertStudentByEmail(email, email.split("@")[0]);
  const [course] = await sql<{ id: string }[]>`
    insert into courses (student_id, code, display_code, color) values (${s.id}, ${code}, ${code}, '#000') returning id`;
  const [t] = await sql<{ id: string }[]>`insert into topics (student_id, course_id, name) values (${s.id}, ${course.id}, ${topic}) returning id`;
  await sql`insert into topic_scores (student_id, topic_id, source, score) values (${s.id}, ${t.id}, 'teach', ${score})`;
  return s;
}

describe("sharing with an instructor", () => {
  it("shows only consenting students, only for the class's course, and stops at once", async () => {
    const faculty = (await createFaculty("rivera@school.edu", "Dr. Rivera", "x", null))!;
    const cls = await createClass(faculty.id, "Pharmacology", "pharm 201");
    expect(cls.courseCode).toBe("PHARM201");
    expect(cls.joinCode).toMatch(/^PHARM-[A-Z2-9]{4}$/);
    expect((await classByJoinCode(cls.joinCode.toLowerCase()))?.instructor).toBe("Dr. Rivera");

    const ana = await studentWithCourse("ana@school.edu", "PHARM201", "Cardiac Drugs", 40);
    await studentWithCourse("ben@school.edu", "PHARM201", "Cardiac Drugs", 90); // never joins
    // Ana's other course must never reach the dashboard.
    const [other] = await sql<{ id: string }[]>`insert into courses (student_id, code, display_code, color) values (${ana.id}, 'PSYC220', 'PSYC 220', '#000') returning id`;
    await sql`insert into topics (student_id, course_id, name) values (${ana.id}, ${other.id}, 'Attachment Theory')`;

    await joinClass(ana.id, cls.id);
    let { members, notSharing } = await classMembers(cls.id);
    expect(members.map((m) => m.name)).toEqual(["ana"]);
    expect(members[0].topics.map((t) => t.name)).toEqual(["Cardiac Drugs"]);
    expect(notSharing).toBe(0);
    const [consent] = await sql<{ textShown: string }[]>`select text_shown from consents where class_id = ${cls.id}`;
    expect(consent.textShown).toMatch(/stay private/);

    await stopSharing(ana.id, cls.id);
    ({ members, notSharing } = await classMembers(cls.id));
    expect(members).toEqual([]);
    expect(notSharing).toBe(1);
    expect((await studentClasses(ana.id))[0].sharing).toBe(false);
    expect((await facultyClasses(faculty.id))[0]).toMatchObject({ members: 1, sharing: 0 });

    // Rejoining records a fresh consent; the history stays.
    await joinClass(ana.id, cls.id);
    expect((await classMembers(cls.id)).members).toHaveLength(1);
    const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from consents where class_id = ${cls.id}`;
    expect(count).toBe(3);
  });
});

describe("the demo class", () => {
  it("seeds a class whose report has a next exam, at-risk students, and a misconception", async () => {
    await seedDemo(process.env.DATABASE_URL!);
    const cls = (await classByJoinCode("PHARM-DEMO"))!;
    const { members, notSharing } = await classMembers(cls.id);
    expect(members).toHaveLength(22);
    expect(notSharing).toBe(2);
    const report = classReport(members);
    expect(report.exam?.title).toBe("Exam 2: Cardiovascular Drugs");
    expect(report.atRisk.length).toBeGreaterThan(3);
    expect(report.topics.find((t) => t.name === "Cardiac Drugs")!.confidentWrong).toBeGreaterThan(2);
  });
});
