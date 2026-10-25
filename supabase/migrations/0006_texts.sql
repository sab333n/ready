-- Phase 4: the text loop. Every text in or out is logged (audit, daily cap, dedupe),
-- and nudges carry one-tap links that sign the student in and open a session.

create table sms_messages (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  direction text not null check (direction in ('out', 'in')),
  -- nudge: Ready decided; instructor: an instructor asked; test: the student asked; reply: answer to an inbound text.
  kind text not null check (kind in ('nudge', 'instructor', 'test', 'reply', 'snooze', 'other')),
  body text not null,
  status text not null check (status in ('sent', 'dry_run', 'failed', 'received')),
  error text,
  provider_id text,
  deadline_id uuid references deadlines(id) on delete set null,
  topic_id uuid references topics(id) on delete set null,
  created_at timestamptz not null default now()
);
create index sms_messages_student on sms_messages (student_id, created_at desc);

-- Only a hash of the token is stored; the link itself lives in the text message.
create table login_links (
  token_hash text primary key,
  student_id uuid not null references students(id) on delete cascade,
  topic_id uuid references topics(id) on delete cascade,
  expires_at timestamptz not null,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
create index login_links_student on login_links (student_id);
