// Seeds a fictional PHARM 201 class so the instructor dashboard can be demoed:
// one instructor, 24 students with realistic readiness evidence, an exam in
// four days, and a class-wide misconception about digoxin and potassium.
// All people are fictional. Safe to re-run: it replaces only demo rows.
// Usage: npm run seed:demo   (sign in at /faculty as demo-instructor@ready.test)
import postgres from "postgres";
import { hashPassword } from "../src/lib/auth/password";

const INSTRUCTOR = { email: "demo-instructor@ready.test", name: "Dr. A. Rivera", school: "Demo University School of Nursing" };
const PASSWORD = process.env.DEMO_PASSWORD ?? "ready-demo-2026";
const JOIN_CODE = "PHARM-DEMO";
const DAY = 864e5;

const TOPICS: { name: string; builtOn: string[] }[] = [
  { name: "Pharmacology Foundations", builtOn: [] },
  { name: "Pharmacokinetics and Pharmacodynamics", builtOn: ["Pharmacology Foundations"] },
  { name: "Dosage Calculation", builtOn: ["Pharmacokinetics and Pharmacodynamics"] },
  { name: "Autonomic Nervous System Drugs", builtOn: ["Pharmacokinetics and Pharmacodynamics"] },
  { name: "Antihypertensives", builtOn: ["Autonomic Nervous System Drugs"] },
  { name: "Cardiac Drugs", builtOn: ["Antihypertensives"] },
  { name: "Anticoagulants", builtOn: ["Pharmacokinetics and Pharmacodynamics"] },
  { name: "Antimicrobials", builtOn: ["Pharmacokinetics and Pharmacodynamics"] },
  { name: "Respiratory Drugs", builtOn: ["Autonomic Nervous System Drugs"] },
  { name: "Gastrointestinal Drugs", builtOn: ["Pharmacokinetics and Pharmacodynamics"] },
];

const NAMES = [
  "Aaliyah Broussard", "Marcus Thibodeaux", "Sofia Nguyen", "Jalen Landry", "Emma Hebert", "Darius Washington",
  "Camille Arceneaux", "Luis Ramirez", "Taylor Fontenot", "Imani Jackson", "Hannah Guidry", "Andre Batiste",
  "Mia LeBlanc", "Kevin Tran", "Brianna Richard", "Noah Boudreaux", "Zoe Mouton", "Elijah Harris",
  "Grace Comeaux", "Jasmine Pierre", "Ethan Savoie", "Destiny Williams", "Lucas Doucet", "Ava Chauvin",
];

// Who is where, by index into NAMES. Everyone else is a solid, steady student.
const STRUGGLING = new Set([3, 9, 15, 21]);
const MIDDLING = new Set([1, 5, 7, 12, 17, 19, 23]);
const INACTIVE = new Set([11, 20]);
const SURE_BUT_WRONG = new Set([1, 3, 7, 12, 15, 19]); // the digoxin/potassium mix-up
const NOT_SHARING = new Set([22, 23]);

// Deterministic, so the demo looks the same every time.
let state = 20261214;
const rand = () => ((state = (state * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
const between = (lo: number, hi: number) => Math.round(lo + rand() * (hi - lo));

export async function seedDemo(databaseUrl: string, now = new Date()) {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    await sql`delete from students where email like '%@demo.ready.test'`;
    await sql`delete from faculty where email = ${INSTRUCTOR.email}`;
    await sql`delete from classes where join_code = ${JOIN_CODE}`;

    const [faculty] = await sql<{ id: string }[]>`
      insert into faculty (email, display_name, password_hash, school)
      values (${INSTRUCTOR.email}, ${INSTRUCTOR.name}, ${await hashPassword(PASSWORD)}, ${INSTRUCTOR.school}) returning id`;
    const [cls] = await sql<{ id: string }[]>`
      insert into classes (faculty_id, name, course_code, display_code, join_code)
      values (${faculty.id}, 'Pharmacology for Nursing Practice', 'PHARM201', 'PHARM 201', ${JOIN_CODE}) returning id`;

    for (const [i, name] of NAMES.entries()) {
      const email = `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@demo.ready.test`;
      const [student] = await sql<{ id: string }[]>`
        insert into students (email, display_name, school, major, year, timezone, onboarding_done_at)
        values (${email}, ${name}, ${INSTRUCTOR.school}, 'Nursing', 'Sophomore', 'America/Chicago', ${new Date(now.getTime() - 40 * DAY)})
        returning id`;
      const [course] = await sql<{ id: string }[]>`
        insert into courses (student_id, code, display_code, name, color)
        values (${student.id}, 'PHARM201', 'PHARM 201', 'Pharmacology for Nursing Practice', '#2563eb') returning id`;

      const ids = new Map<string, string>();
      for (const [position, t] of TOPICS.entries()) {
        const [row] = await sql<{ id: string }[]>`
          insert into topics (student_id, course_id, name, position) values (${student.id}, ${course.id}, ${t.name}, ${position}) returning id`;
        ids.set(t.name, row.id);
      }
      for (const t of TOPICS) {
        for (const p of t.builtOn) {
          await sql`insert into topic_prerequisites (topic_id, prerequisite_id) values (${ids.get(t.name)!}, ${ids.get(p)!})`;
        }
      }

      const deadlines = [
        { uid: "exam-2", title: "Exam 2: Cardiovascular Drugs", kind: "exam", due: 4 },
        { uid: "quiz-4", title: "Quiz 4: Anticoagulants", kind: "quiz", due: 11 },
        { uid: "exam-3", title: "Exam 3: Respiratory and GI Drugs", kind: "exam", due: 25 },
        { uid: "case-study", title: "Medication Safety Case Study", kind: "assignment", due: 18 },
      ];
      for (const d of deadlines) {
        const dueAt = new Date(now.getTime() + d.due * DAY);
        dueAt.setUTCHours(15, 0, 0, 0);
        await sql`
          insert into deadlines (student_id, course_id, source, external_uid, title, kind, due_at, all_day)
          values (${student.id}, ${course.id}, 'ics', ${d.uid}, ${d.title}, ${d.kind}, ${dueAt}, false)`;
      }

      // Evidence: earlier topics are measured for most students, later ones only for some.
      // The exam is in four days, so most students have reached Cardiac Drugs (topic 6).
      const reached = INACTIVE.has(i) ? 3 : STRUGGLING.has(i) ? between(4, 6) : MIDDLING.has(i) ? between(5, 7) : between(6, 8);
      const covered = SURE_BUT_WRONG.has(i) ? Math.max(reached, 6) : reached;
      for (const [position, t] of TOPICS.slice(0, covered).entries()) {
        const level = STRUGGLING.has(i) ? [20, 52] : MIDDLING.has(i) ? [52, 78] : [74, 96];
        const sessions = INACTIVE.has(i) ? 1 : between(1, 3);
        for (let s = 0; s < sessions; s++) {
          const age = INACTIVE.has(i) ? between(10, 16) : between(0, 12) + (covered - position);
          let score = between(level[0], level[1]);
          let confidentWrong = false;
          if (t.name === "Cardiac Drugs" && SURE_BUT_WRONG.has(i) && s === sessions - 1) {
            score = Math.min(score, between(30, 55));
            confidentWrong = true;
          }
          await sql`
            insert into topic_scores (student_id, topic_id, source, score, confident_wrong, created_at)
            values (${student.id}, ${ids.get(t.name)!}, ${s === 0 ? "diagnostic" : "teach"}, ${score}, ${confidentWrong},
                    ${new Date(now.getTime() - age * DAY - between(0, 20) * 3600_000)})`;
        }
      }

      await sql`insert into class_members (class_id, student_id, joined_at) values (${cls.id}, ${student.id}, ${new Date(now.getTime() - 30 * DAY)})`;
      await sql`
        insert into consents (student_id, kind, granted, text_shown, source, class_id, created_at)
        values (${student.id}, 'advisor_sharing', ${!NOT_SHARING.has(i)},
                ${NOT_SHARING.has(i) ? "Joined without sharing (demo)." : "Share my Ready progress in PHARM 201 with Dr. A. Rivera (demo consent)."},
                'web', ${cls.id}, ${new Date(now.getTime() - 30 * DAY)})`;
    }
    return { faculty: INSTRUCTOR.email, joinCode: JOIN_CODE, students: NAMES.length };
  } finally {
    await sql.end();
  }
}

if (process.argv[1]?.endsWith("seed-demo.ts")) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
  seedDemo(url)
    .then((r) => console.log(`Seeded ${r.students} demo students. Instructor: ${r.faculty} · join code ${r.joinCode}`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
