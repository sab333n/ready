-- Phase 1: students, goals, courses, deadlines, materials, topics, consents.
-- Runs on plain Postgres (local dev) and on Supabase.

create extension if not exists pgcrypto;

create table students (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  school text,
  major text,
  year text,
  timezone text not null default 'America/New_York',
  study_time text check (study_time in ('morning', 'afternoon', 'night', 'mixed')),
  session_length text check (session_length in ('short', 'long')),
  -- Local hours (0-23) when texts are allowed; end is exclusive.
  text_window_start smallint check (text_window_start between 0 and 23),
  text_window_end smallint check (text_window_end between 1 and 24),
  phone_e164 text unique,
  -- Raw onboarding answers; the normalized columns above are written from these.
  onboarding_answers jsonb not null default '{}'::jsonb,
  onboarding_done_at timestamptz,
  created_at timestamptz not null default now()
);

create table goals (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  kind text not null check (kind in ('semester', 'licensing_exam', 'internship', 'gpa', 'clinicals', 'other')),
  label text not null,
  target text,
  created_at timestamptz not null default now()
);

create table courses (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  -- Normalized code, e.g. PHARM201. Used to merge calendar and syllabus data.
  code text not null,
  display_code text not null,
  name text,
  color text not null,
  created_at timestamptz not null default now(),
  unique (student_id, code)
);

create table calendar_feeds (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  url text not null,
  last_synced_at timestamptz,
  last_error text,
  unique (student_id, url)
);

create table materials (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  course_id uuid references courses(id) on delete set null,
  filename text not null,
  mime text not null,
  kind text not null check (kind in ('syllabus', 'slides', 'screenshot', 'other')),
  -- We keep extracted text only (least data); the original file is not stored.
  extracted_text text not null,
  sha256 text not null,
  created_at timestamptz not null default now(),
  unique (student_id, sha256)
);

create table deadlines (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  course_id uuid references courses(id) on delete set null,
  title text not null,
  kind text not null check (kind in ('exam', 'quiz', 'assignment', 'other')),
  due_at timestamptz not null,
  all_day boolean not null default false,
  source text not null check (source in ('ics', 'upload', 'manual')),
  -- ICS UID, or a content hash for uploads/manual entries; makes re-imports idempotent.
  external_uid text not null,
  material_id uuid references materials(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (student_id, source, external_uid)
);
create index deadlines_student_due on deadlines (student_id, due_at);

create table topics (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  course_id uuid not null references courses(id) on delete cascade,
  name text not null,
  position integer not null default 0,
  material_id uuid references materials(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index topics_course_name on topics (course_id, lower(name));

create table topic_prerequisites (
  topic_id uuid not null references topics(id) on delete cascade,
  prerequisite_id uuid not null references topics(id) on delete cascade,
  primary key (topic_id, prerequisite_id),
  check (topic_id <> prerequisite_id)
);

create table consents (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  kind text not null check (kind in ('sms', 'advisor_sharing')),
  granted boolean not null,
  -- Exact wording the student agreed to, so we can prove what they saw.
  text_shown text not null,
  source text not null check (source in ('web', 'sms')),
  created_at timestamptz not null default now()
);
-- Latest row per (student, kind) is the current state; history is kept as an audit log.
create index consents_latest on consents (student_id, kind, created_at desc);

