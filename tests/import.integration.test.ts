// Runs against a real Postgres (TEST_DATABASE_URL, default ready_test).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import {
  completeOnboarding,
  currentConsent,
  deleteStudent,
  semesterMap,
  setSmsConsentByPhone,
  ensureNamedTopic,
  upsertStudentByEmail,
  type Student,
} from "@/lib/db/repo";
import { importCalendarText, importMaterial } from "@/lib/importers";
import { setLlmForTesting, type LlmProvider } from "@/lib/llm";
import { applyAnswer, type Answers } from "@/lib/onboarding/flow";
import { demoIcs, syllabusPdf } from "../scripts/make-fixtures";
import { migrate } from "../scripts/migrate";

const NOW = new Date("2026-10-24T12:00:00Z");
let student: Student;

beforeAll(async () => {
  await migrate(process.env.DATABASE_URL!, { log: false });
});

beforeEach(async () => {
  setLlmForTesting(undefined);
  await sql`truncate students cascade`;
  student = await upsertStudentByEmail("riley@demo-university.edu");
});

afterAll(async () => {
  await sql.end();
});

const pdfFile = async () => ({ filename: "pharm-201-syllabus.pdf", mime: "application/pdf", bytes: await syllabusPdf() });

describe("calendar import", () => {
  it("is idempotent: re-importing the same feed updates instead of duplicating", async () => {
    const first = await importCalendarText(student, demoIcs(), NOW);
    expect(first).toMatchObject({ added: 13, updated: 0, courses: 3 });
    const second = await importCalendarText(student, demoIcs(), NOW);
    expect(second).toMatchObject({ added: 0, updated: 13 });
    const map = await semesterMap(student.id);
    expect(map.deadlines).toHaveLength(13);
    expect(map.courses.map((c) => c.displayCode)).toEqual(["NURS 210", "PHARM 201", "PSYC 220"]);
  });
});

describe("syllabus upload", () => {
  it("merges into the calendar's course, skips deadlines already on the calendar, and saves topics", async () => {
    await importCalendarText(student, demoIcs(), NOW);
    const result = await importMaterial(student, await pdfFile(), NOW);
    expect(result.course).toBe("PHARM 201");
    expect(result.usedLlm).toBe(false);
    expect(result.topics).toBe(10);
    // Quiz 3, Exam 2, Quiz 4, case study, Exam 3, final are already in Canvas; the mini-project is new.
    expect(result.duplicates).toBe(6);
    expect(result.added).toBe(1);

    const map = await semesterMap(student.id);
    expect(map.courses).toHaveLength(3);
    expect(map.deadlines.find((d) => /mini-project/.test(d.title))?.source).toBe("upload");
    expect(map.materialCount).toBe(1);
  });

  it("keeps two different PDFs as two materials (regression: hashes were taken after the PDF reader emptied the buffer)", async () => {
    const file = await pdfFile();
    const original = file.bytes.byteLength;
    await importMaterial(student, file, NOW);
    expect(file.bytes.byteLength).toBe(original);
    await importMaterial(student, { filename: "other.pdf", mime: "application/pdf", bytes: await syllabusPdf(["PHARM 201", "Week 1: Something Else"]) }, NOW);
    const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from materials`;
    expect(count).toBe(2);
  });

  it("uses the LLM provider when configured and stores prerequisites", async () => {
    const fake: LlmProvider = {
      name: "fake",
      generateObject: async () => ({
        course: { code: "PHARM 201", name: "Pharmacology" },
        deadlines: [{ title: "Exam 2: Cardiovascular Drugs", kind: "exam", date: "2026-10-29", time: "10:00" }],
        topics: [
          { name: "Pharmacokinetics", prerequisites: [] },
          { name: "Antihypertensives", prerequisites: ["Pharmacokinetics"] },
          { name: "Cardiac drugs", prerequisites: ["Antihypertensives", "Made-up topic"] },
        ],
        notes: null,
      }) as never,
    };
    setLlmForTesting(fake);
    const result = await importMaterial(student, await pdfFile(), NOW);
    expect(result.usedLlm).toBe(true);
    const map = await semesterMap(student.id);
    expect(map.topics.find((t) => t.name === "Cardiac drugs")?.prerequisites).toEqual(["Antihypertensives"]);
    expect(map.deadlines[0].dueAt.toISOString()).toBe("2026-10-29T14:00:00.000Z"); // 10am Eastern
  });

  it("falls back to the offline reader if the LLM call fails", async () => {
    setLlmForTesting({ name: "broken", generateObject: async () => Promise.reject(new Error("timeout")) });
    const result = await importMaterial(student, await pdfFile(), NOW);
    expect(result.usedLlm).toBe(false);
    expect(result.topics).toBe(10);
  });
});

describe("consent and privacy", () => {
  it("records SMS consent with the exact wording, and STOP by text revokes it", async () => {
    let a: Answers = {};
    for (const r of ["Demo U", "Nursing", "Sophomore", "Also NCLEX", "3.5 GPA", "Nights", "Short", "6pm-10pm", "5552013344", "yes"]) {
      a = applyAnswer(a, r).answers;
    }
    await completeOnboarding(student.id, a);
    expect(await currentConsent(student.id, "sms")).toMatchObject({ granted: true });

    expect(await setSmsConsentByPhone("+15552013344", false, 'Texted "STOP"')).toBe(true);
    expect(await currentConsent(student.id, "sms")).toMatchObject({ granted: false });
    const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from consents where student_id = ${student.id}`;
    expect(count).toBe(2); // history kept as an audit trail
    expect(await setSmsConsentByPhone("+15550000000", false, "STOP")).toBe(false);
  });

  it("delete my data removes everything the student owns", async () => {
    await importCalendarText(student, demoIcs(), NOW);
    await importMaterial(student, await pdfFile(), NOW);
    await deleteStudent(student.id);
    for (const table of ["courses", "deadlines", "materials", "topics", "consents", "goals"]) {
      const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from ${sql(table)}`;
      expect(count, table).toBe(0);
    }
  });
});

describe("acceptance: sign-up to semester map", () => {
  it("fills the map from one .ics feed and one syllabus PDF in well under 5 minutes of machine time", async () => {
    const started = performance.now();
    let a: Answers = {};
    for (const r of ["Demo U", "Nursing", "Sophomore", "Also NCLEX", "3.5 and an externship", "Nights", "Short", "6pm-10pm", "skip"]) {
      a = applyAnswer(a, r).answers;
    }
    await completeOnboarding(student.id, a);
    await importCalendarText(student, demoIcs(), NOW);
    await importMaterial(student, await pdfFile(), NOW);
    const map = await semesterMap(student.id);
    expect(map.deadlines.length).toBeGreaterThanOrEqual(14);
    expect(map.topics.length).toBe(10);
    expect(performance.now() - started).toBeLessThan(10_000);
  });
});

describe("topics named by the learner", () => {
  it("adds calculus beside the syllabus topics and keeps the same row on a second request", async () => {
    const first = await ensureNamedTopic(student.id, "calculus");
    const again = await ensureNamedTopic(student.id, "Calculus");
    expect(first.name).toBe("Calculus");
    expect(again.id).toBe(first.id);
    const map = await semesterMap(student.id);
    expect(map.topics.map((t) => t.name)).toContain("Calculus");
    expect(map.courses.some((c) => c.displayCode === "Chosen")).toBe(true);
  });
});
