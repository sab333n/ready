-- Free nudges: browser push notifications. A student allows notifications on a
-- device; each device's subscription is stored, and every push is logged next to texts.

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index push_subscriptions_student on push_subscriptions (student_id);

alter table sms_messages add column channel text not null default 'sms' check (channel in ('sms', 'push'));

alter table consents drop constraint consents_kind_check;
alter table consents add constraint consents_kind_check check (kind in ('sms', 'advisor_sharing', 'push'));
