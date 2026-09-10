-- Keep every non-deleted Utility Bill notification and retain only the newest
-- notification per bill. Run this once in the Supabase SQL Editor.

begin;

delete from public.utility_bill_notifications older
using public.utility_bill_notifications newer
where older.user_id = newer.user_id
  and older.bill_id = newer.bill_id
  and (older.created_at, older.id) < (newer.created_at, newer.id);

alter table public.utility_bill_notifications
  drop constraint if exists utility_bill_notifications_user_id_bill_id_kind_version_key;

alter table public.utility_bill_notifications
  add constraint utility_bill_notifications_user_bill_key unique (user_id, bill_id);

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
  on conflict (user_id, bill_id) do update
    set kind = excluded.kind,
        version = excluded.version,
        created_at = excluded.version,
        read_at = null;
  return new;
end;
$$;

commit;
