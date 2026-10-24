# Ready (working name)

An AI study assistant that knows a student's deadlines and goals, texts them when they are **not ready**, and gets them ready by making them teach the material to AI students.

Built for the Nexus Technology Cup (demo: Dec 14, 2026). Core loop:
deadline known → readiness measured → plan made → student teaches AI students → readiness updated → next text sent.

## Status

| Phase | What | State |
|---|---|---|
| 1 | Onboarding + semester map | **Built** |
| 2 | Teaching classroom (voice, AI students, teach-back) | Not started |
| 3 | Readiness map + weekly plan | Not started |
| 4 | Text assistant (Twilio) | STOP/START/HELP only |
| 5 | Advisor dashboard + demo seed | Not started |

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

Open http://localhost:3000, sign in with any email (dev mode), finish the chat, then on the next page paste
`http://localhost:3000/demo/demo-canvas.ics` and upload `fixtures/pharm-201-syllabus.pdf`.

- **Sign-in:** with `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` set, sign-in sends a Supabase magic link. Without them, dev sign-in trusts the typed email (disabled in production).
- **AI reading:** `LLM_PROVIDER=anthropic` plus `ANTHROPIC_API_KEY` uses Claude to read syllabi and screenshots. `none` (the default) uses an offline parser for PDFs; screenshots need the AI reader.

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
src/lib/llm/                 provider-agnostic LLM interface (Claude today)
src/lib/onboarding/flow.ts   onboarding state machine (pure, tested)
src/lib/calendar/ics.ts      Canvas / Moodle / Blackboard .ics parsing
src/lib/materials/           PDF text, AI extraction, offline parser
src/lib/sms/                 phone numbers, STOP/START/HELP, Twilio signatures
src/lib/db/repo.ts           all SQL, always scoped by student
src/app/                     pages: / → /onboarding → /connect → /map
```

## Ground rules baked in

- Never completes graded work; the extraction prompt tells the model not to answer questions it finds in materials.
- Least data: uploads keep only the extracted text, never the original file. "Delete my data" removes everything.
- SMS consent stores the exact wording shown and a timestamp; STOP by text always revokes it, and the history is kept for audit.
- Never asks for Pearson or other homework-site logins; screenshots instead.
- All demo data is fictional.
- The learn-by-teaching classroom is inspired by the Dasko hackathon project, and measure-plan-teach-practice by LearnHarness (AGPL-3.0). No code is copied from either.
