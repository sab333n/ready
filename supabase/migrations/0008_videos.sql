-- Narrated lesson videos an instructor makes for a class. A video is a script of
-- scenes plus one narration clip per scene; the browser plays them as slides.
-- Watching never changes readiness; teaching it back afterwards does.

create table lesson_videos (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes(id) on delete cascade,
  topic_name text not null,
  title text not null,
  focus text,
  -- [{ title, points: [..], narration }]
  scenes jsonb not null,
  used_llm boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'shared')),
  created_at timestamptz not null default now(),
  shared_at timestamptz
);
create index lesson_videos_class on lesson_videos (class_id, created_at desc);

create table lesson_video_audio (
  video_id uuid not null references lesson_videos(id) on delete cascade,
  scene integer not null,
  mime text not null,
  audio bytea not null,
  primary key (video_id, scene)
);

create table lesson_video_views (
  video_id uuid not null references lesson_videos(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  finished_at timestamptz,
  primary key (video_id, student_id)
);

-- A one-tap link can open a page (e.g. a video) instead of starting a session.
alter table login_links add column redirect_to text;
