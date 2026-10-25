-- Canvas connection: the student's school address and access token, plus a deadline source.

alter table deadlines drop constraint if exists deadlines_source_check;
alter table deadlines add constraint deadlines_source_check check (source in ('ics', 'upload', 'manual', 'canvas'));

create table if not exists canvas_links (
  student_id uuid primary key references students(id) on delete cascade,
  base_url text not null,
  token text not null,
  connected_at timestamptz not null default now()
);
