-- Phase 5: instructors see a class's readiness, only for students who chose to share.
-- Readiness itself is still derived from topic_scores at read time; nothing here copies it.

create table faculty (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text not null,
  password_hash text not null,
  school text,
  created_at timestamptz not null default now()
);

create table classes (
  id uuid primary key default gen_random_uuid(),
  faculty_id uuid not null references faculty(id) on delete cascade,
  name text not null,
  -- Normalized course code (PHARM201): matches the courses students already imported.
  course_code text not null,
  display_code text not null,
  -- What students type to join, e.g. PHARM-7KQ2.
  join_code text not null unique,
  created_at timestamptz not null default now()
);
create index classes_faculty on classes (faculty_id, created_at desc);

create table class_members (
  class_id uuid not null references classes(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (class_id, student_id)
);
create index class_members_student on class_members (student_id);

-- Sharing consent is per class. The latest row per (student, class) is the current state;
-- older rows stay as the audit trail, like SMS consent.
alter table consents add column class_id uuid references classes(id) on delete cascade;
create index consents_class on consents (student_id, class_id, created_at desc) where class_id is not null;
