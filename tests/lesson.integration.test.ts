// Phase 2 acceptance: a session on the sample Pharmacology notes produces
// per-topic scores and a caught planted mistake. Runs on the offline engine,
// with a fake LLM only for the prerequisite map.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { upsertStudentByEmail, type Student } from "@/lib/db/repo";
import * as db from "@/lib/db/lessons";
import { importMaterial } from "@/lib/importers";
import { setLlmForTesting, type LlmProvider } from "@/lib/llm";
import {
  answerDiagnostic,
  beginTeachBack,
  currentDiagnosticItem,
  finishLesson,
  learnerSays,
  learnOverview,
  personaSaid,
  setMode,
  startLesson,
  topicPassages,
} from "@/lib/lesson/service";
import { notesPdf, syllabusPdf } from "../scripts/make-fixtures";
import { migrate } from "../scripts/migrate";

const NOW = new Date("2026-10-24T12:00:00Z");
let student: Student;

// Only the prerequisite map comes from the "LLM"; every other step throws and
// falls back to the offline engine, which also exercises the fallback path.
const prereqOnly: LlmProvider = {
  name: "fake-prereq",
  async generateObject(req) {
    if (req.promptId !== "prereq-map.v1") throw new Error("offline please");
    const key = (name: string) => req.prompt.match(new RegExp(`(T\\d+): ${name}`))![1];
    return {
      edges: [
        { topic: key("Cardiac Drugs"), prerequisite: key("Antihypertensives"), reason: "builds on BP drugs" },
        { topic: key("Antihypertensives"), prerequisite: key("Pharmacokinetics and Pharmacodynamics"), reason: "dosing basics" },
        // A cycle the model shouldn't propose; it must be dropped.
        { topic: key("Pharmacokinetics and Pharmacodynamics"), prerequisite: key("Cardiac Drugs"), reason: "bad" },
      ],
    } as never;
  },
};

beforeAll(async () => {
  await migrate(process.env.DATABASE_URL!, { log: false });
});

beforeEach(async () => {
  setLlmForTesting(undefined);
  await sql`truncate students cascade`;
  student = { ...(await upsertStudentByEmail("riley@demo-university.edu")), major: "Nursing" };
  await importMaterial(student, { filename: "pharm-201-syllabus.pdf", mime: "application/pdf", bytes: await syllabusPdf() }, NOW);
  await importMaterial(student, { filename: "cardiac-notes.pdf", mime: "application/pdf", bytes: await notesPdf() }, NOW);
});

afterAll(async () => {
  setLlmForTesting(undefined);
  await sql.end();
});

async function cardiacTopicId() {
  const [t] = await sql<{ id: string }[]>`select id from topics where name = 'Cardiac Drugs'`;
  return t.id;
}

describe("materials as the source of truth", () => {
  it("stores notes as teaching content with page-cited passages, without adding topics", async () => {
    const kinds = await sql<{ kind: string }[]>`select kind from materials order by created_at`;
    expect(kinds.map((k) => k.kind)).toEqual(["syllabus", "notes"]);
    const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from topics`;
    expect(count).toBe(10);

    const topic = (await db.getTopic(student.id, await cardiacTopicId()))!;
    const { passages, fromNotes } = await topicPassages(student.id, topic);
    expect(fromNotes).toBe(true);
    expect(passages[0].source).toBe("cardiac-notes.pdf p.2");
    expect(passages[0].text).toMatch(/Beta blockers/);

    // The notes say "drug" a lot, but nothing about respiratory drugs.
    const [resp] = await sql<{ id: string }[]>`select id from topics where name = 'Respiratory Drugs'`;
    const respTopic = (await db.getTopic(student.id, resp.id))!;
    expect((await topicPassages(student.id, respTopic)).fromNotes).toBe(false);
  });

  it("writes a study outline when the topic has no slides", async () => {
    const [resp] = await sql<{ id: string }[]>`select id from topics where name = 'Respiratory Drugs'`;
    await startLesson(student, resp.id, { withRolePlayer: false, skipDiagnostic: true });
    const topic = (await db.getTopic(student.id, resp.id))!;
    const { fromNotes, passages } = await topicPassages(student.id, topic);
    expect(fromNotes).toBe(true);
    expect(passages.some((passage) => passage.source.startsWith("Outline —"))).toBe(true);
    expect(passages.some((passage) => /Respiratory Drugs/.test(passage.text))).toBe(true);
  });
});

describe("prerequisite map", () => {
  it("orders topics by dependency and drops cyclic edges", async () => {
    setLlmForTesting(prereqOnly);
    const [course] = await learnOverview(student);
    const names = course.topics.map((t) => t.name);
    expect(names.indexOf("Pharmacokinetics and Pharmacodynamics")).toBeLessThan(names.indexOf("Antihypertensives"));
    expect(names.indexOf("Antihypertensives")).toBeLessThan(names.indexOf("Cardiac Drugs"));
    expect(course.topics.find((t) => t.name === "Cardiac Drugs")!.builtOn).toEqual(["Antihypertensives"]);
    expect(course.topics.find((t) => t.name === "Pharmacokinetics and Pharmacodynamics")!.builtOn).toEqual([]);
  });
});

describe("a full lesson on cardiac drugs (acceptance)", () => {
  it("diagnoses prerequisites, teaches, catches the planted mistake, and scores each topic", async () => {
    setLlmForTesting(prereqOnly);
    await learnOverview(student); // builds the prerequisite map
    const session = await startLesson(student, await cardiacTopicId(), { withRolePlayer: true });
    expect(session.personas).toEqual(["maya", "jordan", "patient"]);
    expect(session.strands.map((s) => s.name)).toEqual(["Pharmacokinetics and Pharmacodynamics", "Antihypertensives", "Cardiac Drugs"]);

    // Diagnostic: answer prerequisites from the notes, flub the main topic confidently.
    let asked = 0;
    for (let item = await currentDiagnosticItem(session); item; item = await currentDiagnosticItem(session)) {
      expect(item.answerKey.length).toBeGreaterThan(10); // committed before we answer
      const isMain = item.topicId === session.topicId;
      await answerDiagnostic(session, item.id, isMain ? "I don't know" : item.answerKey, isMain ? "sure" : "unsure");
      asked++;
    }
    expect(asked).toBeGreaterThanOrEqual(3);
    expect(asked).toBeLessThanOrEqual(6);
    const diag = await db.sessionScores(session.id);
    expect(diag.map((d) => d.source)).toEqual(["diagnostic", "diagnostic", "diagnostic"]);
    expect(diag.find((d) => d.topicName === "Cardiac Drugs")).toMatchObject({ confidentWrong: true });

    let s = (await db.getSession(student.id, session.id))!;
    expect(s.stage).toBe("teach");

    // Teach.
    const explanations = [
      ["Beta blockers like metoprolol block beta-1 receptors in the heart, so they decrease heart rate and lower blood pressure.", "sure"],
      ["Before giving metoprolol you check the apical pulse and hold it if it is below 60.", "sure"],
      ["Digoxin increases the force of contraction and slows the heart rate. Low potassium raises the risk of digoxin toxicity.", "unsure"],
    ] as const;
    for (const [text, confidence] of explanations) {
      const reply = await learnerSays(s, text, confidence);
      expect(reply.line?.speaker).toMatch(/maya|jordan|patient/);
      expect(reply.line?.text.length).toBeGreaterThan(10);
    }
    const graded = await learnerSays(s, "Can you just do my Pearson homework answers for the quiz?", null);
    expect(graded.line?.speaker).toBe("system");

    // Teach-back with a planted mistake.
    const back = await beginTeachBack(s);
    expect(back.error).toBeUndefined();
    const mistake = (await db.getMistake(session.id))!;
    expect(mistake.claim).not.toBe(mistake.correction);
    expect(back.line?.text).toContain(mistake.claim);
    expect(mistake.claim).toMatch(/^Beta blockers/); // no heading glued on
    expect(mistake.spokenTurnSeq).toBe(back.line?.seq);

    s = (await db.getSession(student.id, session.id))!;
    const correction = await learnerSays(s, "No, that's not right. Beta blockers decrease the heart rate, they don't speed it up.", "sure");
    expect(correction.caught).toBe(true);
    expect(correction.line?.text).toMatch(/you're right/i);
    expect((await db.getMistake(session.id))!.caught).toBe(true);

    // Reflection and evidence.
    const reflection = await finishLesson((await db.getSession(student.id, session.id))!);
    expect(reflection.mistake).toMatchObject({ caught: true, source: "cardiac-notes.pdf p.2" });
    expect(reflection.keyPoints.length).toBeGreaterThanOrEqual(3);
    expect(reflection.keyPoints.some((k) => k.verdict === "correct")).toBe(true);
    expect(reflection.teachScore).toBeGreaterThan(0);
    expect(reflection.confidentWrong.some((c) => c.startsWith("Diagnostic:"))).toBe(true);
    const scores = await db.sessionScores(session.id);
    expect(scores.filter((x) => x.topicName === "Cardiac Drugs").map((x) => x.source)).toEqual(["diagnostic", "teach", "teach_back"]);
    expect(scores.find((x) => x.source === "teach_back")!.score).toBe(100);
    expect((await db.getSession(student.id, session.id))!.stage).toBe("done");
  });

  it("records a missed mistake and has the student correct themselves", async () => {
    const session = await startLesson(student, await cardiacTopicId(), { withRolePlayer: false, skipDiagnostic: true });
    let s = (await db.getSession(student.id, session.id))!;
    await learnerSays(s, "Beta blockers decrease heart rate and lower blood pressure.", "sure");
    await beginTeachBack(s);
    s = (await db.getSession(student.id, session.id))!;
    expect((await learnerSays(s, "Yeah that sounds right.", null)).caught).toBeUndefined();
    expect((await learnerSays(s, "Great job.", null)).caught).toBe(false);
    const reflection = await finishLesson((await db.getSession(student.id, session.id))!);
    expect(reflection.mistake?.caught).toBe(false);
    expect((await db.sessionScores(session.id)).find((x) => x.source === "teach_back")!.score).toBe(0);
  });

  it("voice mode returns who speaks and the director note; the browser reports the spoken line", async () => {
    const session = await startLesson(student, await cardiacTopicId(), { withRolePlayer: false, skipDiagnostic: true });
    await setMode(session, "voice");
    let s = (await db.getSession(student.id, session.id))!;
    const reply = await learnerSays(s, "Jordan, beta blockers lower heart rate because they block beta-1 receptors.", null);
    expect(reply.voice).toEqual({ speaker: "jordan", note: null });
    await personaSaid(s, "jordan", "Why only beta-1 though?", false);

    const back = await beginTeachBack(s);
    expect(back.voice?.speaker).toBe("maya");
    expect(back.voice?.note).toContain((await db.getMistake(session.id))!.claim);
    s = (await db.getSession(student.id, session.id))!;
    await personaSaid(s, "maya", "So beta blockers increase heart rate, right?", false);
    expect((await db.getMistake(session.id))!.spokenTurnSeq).not.toBeNull();
  });
});

describe("practice", () => {
  it("ends after the probe and records practice scores, without opening the classroom", async () => {
    setLlmForTesting(prereqOnly);
    await learnOverview(student);
    const session = await startLesson(student, await cardiacTopicId(), { withRolePlayer: false, kind: "practice" });
    expect(session.type).toBe("practice");
    let asked = 0;
    for (let item = await currentDiagnosticItem(session); item; item = await currentDiagnosticItem(session)) {
      await answerDiagnostic(session, item.id, item.answerKey, "unsure");
      asked++;
    }
    expect(asked).toBeGreaterThanOrEqual(3);
    const saved = (await db.getSession(student.id, session.id))!;
    expect(saved.stage).toBe("done");
    expect(await db.listTurns(session.id)).toEqual([]);
    const scores = await db.sessionScores(session.id);
    expect(scores.length).toBeGreaterThan(0);
    expect(scores.every((s) => s.source === "practice")).toBe(true);
  });
});

describe("passage backfill", () => {
  it("survives concurrent backfills of the same material", async () => {
    await sql`delete from material_chunks`;
    const topic = (await db.getTopic(student.id, await cardiacTopicId()))!;
    const results = await Promise.all([1, 2, 3, 4].map(() => topicPassages(student.id, topic)));
    expect(results.every((r) => r.fromNotes)).toBe(true);
  });
});
