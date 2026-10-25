-- Accounts: a display name from Google or sign-up, and a password for database login.
-- Google sign-in leaves password_hash empty.

alter table students add column if not exists display_name text;
alter table students add column if not exists password_hash text;
