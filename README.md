# Ready (working name)

An AI study assistant that knows a student's deadlines and goals, texts them when they are **not ready**, and gets them ready by making them teach the material to AI students.

Built for the Nexus Technology Cup (demo: Dec 14, 2026). Core loop:
deadline known → readiness measured → plan made → student teaches AI students → readiness updated → next text sent.

## Status

| Phase | What | State |
|---|---|---|
| 1 | Onboarding + semester map | **Built** |
| 2 | Teaching classroom (probe, AI students, teach-back, reflection, voice) | **Built** |
| 3 | Readiness per topic and per exam, "Up next" on the semester page | **Built** (weekly plan not started) |
| 4 | Text assistant (Twilio) | STOP/START/HELP only |
| 5 | Instructor dashboard (consent-based sharing) + demo seed | **Built** |

Readiness is derived from evidence, never stored: every probe answer, teaching session and teach-back writes a
`topic_scores` row, and `src/lib/readiness.ts` weighs them by source and recency (14-day half-life). An exam or quiz
covers the topics its title names plus what they build on; an exam that names none covers the whole course.

### Instructor dashboard

Instructors sign up at `/faculty`, create a class with its Canvas course code, and get a join code (e.g. `PHARM-7KQ2`).
A student enters the code on their semester page, sees exactly what will be shared, and agrees. The dashboard shows,
for students whose latest consent is "share": readiness for the next exam, who needs attention and why, topics the class
is confidently wrong about, and a student × topic heatmap. It reads only scores for that course, never notes, files,
transcripts or phone numbers. "Stop sharing" takes effect immediately; every consent change is kept as an audit row.

Demo: `npm run seed:demo` creates a fictional PHARM 201 class (24 students, exam in four days). Sign in at `/faculty`
as `demo-instructor@ready.test` with password `ready-demo-2026` (override with `DEMO_PASSWORD`). Students can join it with `PHARM-DEMO`.

## Run it

Needs Node 20.9+ and a Postgres database (local or Supabase).

```bash
cp .env.example .env.local     # defaults work with local Postgres
createdb ready_dev && createdb ready_test
npm install
npm run db:migrate
npm run fixtures               # fake demo calendar + syllabus
npm run dev
```

Open http://localhost:3000, continue with Google or create an account, finish the chat, then on the next page paste
`http://localhost:3000/demo/demo-canvas.ics` and upload `fixtures/pharm-201-syllabus.pdf`.

- **Sign-in:** the front page leads to Google (Supabase Auth, same provider setup as Interlink) or an email and password stored in this app's database. Google needs `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Add `http://localhost:3000/auth/callback` to the Supabase redirect allow list.
- **AI reading:** `LLM_PROVIDER=gemini` plus `GEMINI_API_KEY` uses Gemini to read syllabi and screenshots, and to run questions, grading, and the classroom. `none` uses an offline parser for PDFs; screenshots need the AI reader. `anthropic` is the Claude alternative.
- **When a model is out of quota:** Gemini calls try `LLM_MODEL`, then each of `LLM_FALLBACK_MODELS` (default `gemini-3.5-flash-lite`). A model that returns 429/503/404 is skipped for a while, so one exhausted quota doesn't slow every call. If every model fails, each step falls back to the offline engine, and the session keeps going.

## Tests

```bash
npm test          # unit tests + integration tests against ready_test (TEST_DATABASE_URL)
npm run lint && npm run typecheck
```

## Layout

```
prompts/                     versioned LLM prompts (<name>.v<N>.md)
supabase/migrations/         SQL schema, one file per phase
scripts/                     migrate, demo fixtures
src/lib/llm/                 provider-agnostic LLM interface (Gemini or Claude), model fallback
src/lib/onboarding/flow.ts   onboarding state machine (pure, tested)
src/lib/calendar/ics.ts      Canvas / Moodle / Blackboard .ics parsing
src/lib/materials/           PDF text, AI extraction, offline parser
src/lib/lesson/service.ts    lesson orchestration: probe → teach → teach-back → reflection
src/lib/readiness.ts         readiness from evidence; which topics an exam covers (pure, tested)
src/lib/sms/                 phone numbers, STOP/START/HELP, Twilio signatures
src/lib/db/repo.ts           all SQL, always scoped by student
src/lib/classes/report.ts    instructor view: class readiness, at-risk students, misconceptions (pure, tested)
src/lib/db/classes.ts        instructors, classes, per-class sharing consent
src/app/                     pages: / → /onboarding → /connect → /map → /learn → /session/[id]; /faculty for instructors
```

## Ground rules baked in

- Never completes graded work; the extraction prompt tells the model not to answer questions it finds in materials.
- Least data: uploads keep only the extracted text, never the original file. "Delete my data" removes everything.
- SMS consent stores the exact wording shown and a timestamp; STOP by text always revokes it, and the history is kept for audit.
- Never asks for Pearson or other homework-site logins; screenshots instead.
- All demo data is fictional.
- The learn-by-teaching classroom is inspired by the Dasko hackathon project, and measure-plan-teach-practice by LearnHarness (AGPL-3.0). No code is copied from either.
