// Lesson videos: an instructor makes one (offline script here, no voice key),
// students in the class can watch it once shared, and teaching it back afterwards
// is what the dashboard counts.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { upsertStudentByEmail } from "@/lib/db/repo";
import { createClass, createFaculty, joinClass } from "@/lib/db/classes";
import { classVideos, facultyVideo, markSeen, studentVideo, studentVideos } from "@/lib/db/videos";
import { makeVideo, shareAndNotify } from "@/lib/video/service";
import { pcmToWav } from "@/lib/video/voice";
import { offlineScript } from "@/lib/video/script";
import { migrate } from "../scripts/migrate";

beforeAll(async () => {
  await migrate(process.env.DATABASE_URL!, { log: false });
});

beforeEach(async () => {
  await sql`truncate students, faculty cascade`;
});

afterAll(async () => {
  await sql.end();
});

async function studentIn(code: string, email: string, score: number | null) {
  const s = await upsertStudentByEmail(email, email.split("@")[0]);
  const [course] = await sql<{ id: string }[]>`insert into courses (student_id, code, display_code, color) values (${s.id}, ${code}, ${code}, '#000') returning id`;
  const [t] = await sql<{ id: string }[]>`insert into topics (student_id, course_id, name) values (${s.id}, ${course.id}, 'Cardiac Drugs') returning id`;
  if (score !== null) await sql`insert into topic_scores (student_id, topic_id, source, score, created_at) values (${s.id}, ${t.id}, 'diagnostic', ${score}, now() - interval '2 days')`;
  return { student: s, topicId: t.id };
}

describe("lesson videos", () => {
  it("makes a draft, shares it with the class, and counts who taught it back", async () => {
    const faculty = (await createFaculty("rivera@school.edu", "Dr. Rivera", "x", null))!;
    const cls = await createClass(faculty.id, "Pharmacology", "PHARM 201");
    const weak = await studentIn("PHARM201", "weak@school.edu", 30);
    const strong = await studentIn("PHARM201", "strong@school.edu", 95);
    const outsider = await studentIn("PHARM201", "outsider@school.edu", 30);
    await joinClass(weak.student.id, cls.id);
    await joinClass(strong.student.id, cls.id);

    const made = await makeVideo(cls, "Cardiac Drugs", "digoxin and potassium");
    expect(made.scenes).toBeGreaterThanOrEqual(4);
    expect(made.narrated).toBe(0); // no voice key in tests: the player uses the device voice

    const draft = (await facultyVideo(faculty.id, made.id))!;
    expect(draft.status).toBe("draft");
    expect(await studentVideo(weak.student.id, made.id)).toBeNull(); // drafts are private

    const shared = await shareAndNotify(faculty.id, faculty.displayName, draft);
    expect(shared).toMatchObject({ needIt: 1, notified: 0 }); // only the weak student, who has no reminders on
    expect(await studentVideo(weak.student.id, made.id)).not.toBeNull();
    expect(await studentVideo(outsider.student.id, made.id)).toBeNull(); // not in the class
    expect((await studentVideos(weak.student.id)).map((v) => v.watched)).toEqual([false]);

    await markSeen(made.id, weak.student.id, false);
    await markSeen(made.id, weak.student.id, true);
    await sql`insert into topic_scores (student_id, topic_id, source, score) values (${weak.student.id}, ${weak.topicId}, 'teach', 80)`;
    const [stats] = await classVideos(cls.id);
    expect(stats).toMatchObject({ watched: 1, finished: 1, taughtBack: 1 });
    expect((await studentVideos(weak.student.id))[0].watched).toBe(true);
  });
});

describe("video pieces", () => {
  it("wraps raw speech audio so every browser can play it", () => {
    const wav = pcmToWav(Buffer.alloc(48000), 24000);
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.length).toBe(48044);
  });

  it("has an offline script that ends by asking for a teach-back", () => {
    const s = offlineScript("Cardiac Drugs");
    expect(s.scenes.at(-1)?.title).toBe("Now teach it back");
    expect(s.scenes.every((x) => x.narration.length > 20)).toBe(true);
  });
});
