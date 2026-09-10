-- Utility Bill notifications should be created only when a new bill is inserted.
-- Run once in the Supabase SQL Editor.

create or replace function public.notify_utility_bill_users()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.utility_bill_notifications (user_id, bill_id, kind, version)
  select r.user_id, new.id, 'new', new.created_at
    from public.utility_user_roles r
   where r.role in ('admin', 'ap')
  union
  select a.user_id, new.id, 'new', new.created_at
    from public.user_section_access a
   where a.section_key = 'utilities'
  union
  select g.user_id, new.id, 'new', new.created_at
    from public.user_global_roles g
   where g.role = 'super_admin'
  on conflict (user_id, bill_id) do nothing;
  return new;
end;
$$;

drop trigger if exists zz_utility_bill_notifications_after_change on public.utility_bills;
create trigger zz_utility_bill_notifications_after_change
  after insert on public.utility_bills
  for each row execute function public.notify_utility_bill_users();

-- Remove old status-change notifications so the bell shows new bills only.
delete from public.utility_bill_notifications
 where kind = 'updated';
