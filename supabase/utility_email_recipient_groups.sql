-- Separate monthly email anchors by recipient group.
-- Run once in the Supabase SQL Editor.

alter table utility_email_threads
  add column if not exists recipient_group_id text not null default 'default';

alter table utility_email_threads
  drop constraint if exists utility_email_threads_billing_month_sender_email_key;

create unique index if not exists utility_email_threads_month_sender_group_key
  on utility_email_threads (billing_month, sender_email, recipient_group_id);

