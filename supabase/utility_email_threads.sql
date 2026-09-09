-- Monthly Utility Bills email threads and idempotent notifications.
-- Run once in the Supabase SQL Editor.

create table if not exists utility_email_threads (
  id uuid primary key default gen_random_uuid(),
  billing_month date not null,
  sender_email text not null,
  root_message_id text not null,
  conversation_id text,
  subject text not null,
  recipients jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (billing_month, sender_email)
);

create table if not exists utility_email_notifications (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references utility_bills(id) on delete cascade,
  thread_id uuid not null references utility_email_threads(id) on delete cascade,
  notification_type text not null default 'bill_updated' check (notification_type in ('bill_updated', 'root')),
  idempotency_key text not null unique,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed')),
  graph_message_id text,
  attempt_count integer not null default 0,
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists utility_email_notifications_bill_idx on utility_email_notifications(bill_id);
create index if not exists utility_email_notifications_thread_idx on utility_email_notifications(thread_id);

alter table utility_email_threads enable row level security;
alter table utility_email_notifications enable row level security;
create policy "utility email threads authenticated read" on utility_email_threads for select to authenticated using (true);
create policy "utility email notifications authenticated read" on utility_email_notifications for select to authenticated using (true);
