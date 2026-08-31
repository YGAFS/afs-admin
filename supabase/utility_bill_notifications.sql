-- Shared Utility Bill notifications for every Utility user (admin + AP).
-- Run once in the Supabase SQL Editor after utility_user_roles exists.

create table if not exists public.utility_bill_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bill_id uuid not null references public.utility_bills(id) on delete cascade,
  kind text not null check (kind in ('new', 'updated')),
  version timestamptz not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (user_id, bill_id, kind, version)
);

create index if not exists utility_bill_notifications_user_created_idx
  on public.utility_bill_notifications (user_id, created_at desc);

alter table public.utility_bill_notifications enable row level security;
drop policy if exists utility_bill_notifications_select_own on public.utility_bill_notifications;
drop policy if exists utility_bill_notifications_update_own on public.utility_bill_notifications;
drop policy if exists utility_bill_notifications_delete_own on public.utility_bill_notifications;

create policy utility_bill_notifications_select_own
  on public.utility_bill_notifications for select to authenticated
  using (user_id = auth.uid());
create policy utility_bill_notifications_update_own
  on public.utility_bill_notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy utility_bill_notifications_delete_own
  on public.utility_bill_notifications for delete to authenticated
  using (user_id = auth.uid());

create or replace function public.notify_utility_bill_users()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.utility_bill_notifications (user_id, bill_id, kind, version)
  select r.user_id, new.id,
         case when tg_op = 'INSERT' then 'new' else 'updated' end,
         case when tg_op = 'INSERT' then new.created_at else new.updated_at end
    from public.utility_user_roles r
   where r.role in ('admin', 'ap')
  union
  select a.user_id, new.id,
         case when tg_op = 'INSERT' then 'new' else 'updated' end,
         case when tg_op = 'INSERT' then new.created_at else new.updated_at end
    from public.user_section_access a
   where a.section_key = 'utilities'
  union
  select g.user_id, new.id,
         case when tg_op = 'INSERT' then 'new' else 'updated' end,
         case when tg_op = 'INSERT' then new.created_at else new.updated_at end
    from public.user_global_roles g
   where g.role = 'super_admin'
  on conflict (user_id, bill_id, kind, version) do nothing;
  delete from public.utility_bill_notifications n
   where n.id in (
     select id from (
       select id, row_number() over (partition by user_id order by created_at desc, id desc) as row_num
       from public.utility_bill_notifications
     ) ranked
     where ranked.row_num > 3
   );
  return new;
end;
$$;

drop trigger if exists zz_utility_bill_notifications_after_change on public.utility_bills;
create trigger zz_utility_bill_notifications_after_change
  after insert or update on public.utility_bills
  for each row execute function public.notify_utility_bill_users();

-- Recover historical notifications for all current Utility users. This is
-- intentionally one initial 'new' notification per existing bill and user.
with utility_users as (
    select user_id from public.utility_user_roles where role in ('admin', 'ap')
    union
    select user_id from public.user_section_access where section_key = 'utilities'
    union
    select user_id from public.user_global_roles where role = 'super_admin'
  ), ranked_bills as (
    select b.*, row_number() over (order by coalesce(b.created_at, b.updated_at, now()) desc, b.id desc) as row_num
    from public.utility_bills b
  )
insert into public.utility_bill_notifications (user_id, bill_id, kind, version)
select u.user_id, b.id, 'new', coalesce(b.created_at, b.updated_at, now())
  from utility_users u
  cross join ranked_bills b
 where b.row_num <= 3
on conflict (user_id, bill_id, kind, version) do nothing;
