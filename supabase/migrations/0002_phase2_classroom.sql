-- Phase 2: teaching classroom. Evidence tables are append-only; readiness
-- (Phase 3) is derived from them, never stored as the source of truth.

-- Notes/slides are teaching content; syllabi are schedules. Only content is used to teach.
alter table materials drop constraint materials_kind_check;
alter table materials add constraint materials_kind_check check (kind in ('syllabus', 'notes', 'slides', 'screenshot', 'other'));

alter table courses add column prereq_map_built_at timestamptz;

-- Passages of a material, so sessions can cite exactly what they used.
create table material_chunks (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references materials(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  ordinal integer not null,
  page integer,
  text text not null,
  unique (material_id, ordinal)
);
create index material_chunks_student on material_chunks (student_id);

alter table topic_prerequisites add column reason text;

-- One teaching session on one topic. Stages: diagnostic -> teach -> teach_back -> done.
create table sessions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  topic_id uuid not null references topics(id) on delete cascade,
  type text not null default 'teach' check (type in ('diagnostic', 'teach', 'teach_back', 'practice')),
  stage text not null default 'diagnostic' check (stage in ('diagnostic', 'teach', 'teach_back', 'done')),
  mode text not null default 'text' check (mode in ('text', 'voice')),
  personas text[] not null,
  -- Diagnostic strands in dependency order: [{ topicId, name }]
  strands jsonb not null default '[]'::jsonb,
  reflection jsonb,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index sessions_student on sessions (student_id, started_at desc);

-- The classroom transcript. speaker is 'learner', 'system', or a persona id.
create table session_turns (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  seq integer not null,
  stage text not null,
  speaker text not null,
  text text not null,
  -- Learner's own sure/unsure tag on what they just explained.
  confidence text check (confidence in ('sure', 'unsure')),
  interrupted boolean not null default false,
  created_at timestamptz not null default now(),
  unique (session_id, seq)
);

-- Diagnostic questions. The answer key is written BEFORE the question is shown
-- and is never edited after (commit before grading).
create table diagnostic_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  topic_id uuid not null references topics(id) on delete cascade,
  ordinal integer not null,
  level text not null check (level in ('basic', 'core', 'deeper')),
  question text not null,
  answer_key text not null,
  chunk_id uuid references material_chunks(id) on delete set null,
  learner_answer text,
  confidence text check (confidence in ('sure', 'unsure')),
  score smallint check (score between 0 and 10),
  rationale text,
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  unique (session_id, ordinal)
);

-- The one deliberate error a teach-back student states. Planned before it is spoken.
create table planted_mistakes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references sessions(id) on delete cascade,
  topic_id uuid not null references topics(id) on delete cascade,
  persona text not null,
  claim text not null,
  correction text not null,
  chunk_id uuid references material_chunks(id) on delete set null,
  spoken_turn_seq integer,
  caught boolean,
  caught_turn_seq integer,
  evidence text,
  created_at timestamptz not null default now()
);

-- Append-only evidence per topic. Phase 3 computes readiness from these rows.
create table topic_scores (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  topic_id uuid not null references topics(id) on delete cascade,
  session_id uuid references sessions(id) on delete set null,
  source text not null check (source in ('diagnostic', 'teach', 'teach_back', 'practice')),
  score smallint not null check (score between 0 and 100),
  confidence text check (confidence in ('sure', 'unsure')),
  -- Learner said "sure" on something graded wrong.
  confident_wrong boolean not null default false,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index topic_scores_lookup on topic_scores (student_id, topic_id, created_at desc);
