-- Stage 2B logical rollback.
-- Exact only if AUTHZ_PERMISSION_MUTATION_FREEZE remains true and no UUID
-- permission mutation occurred after stage2b_cutover.sql committed.
-- If freeze was ever false, run stage2b_post_freeze_rollback_sync.sql first.

begin;

lock table public.user_profiles in share row exclusive mode;

do $assert$
begin
  if (select count(*) from public.user_profiles where authz_migrated_at is not null) <> 4 then
    raise exception 'logical rollback requires all four users to be cut over';
  end if;
end;
$assert$;

-- Keep UUID rows intact for forensic/retry purposes; only disable UUID cutover.
update public.user_profiles
set authz_migrated_at = null, updated_at = clock_timestamp()
where authz_migrated_at is not null;

commit;

-- After this transaction: rollback the deployed code while freeze remains true.
-- Drop the new tables only in a separately approved destructive cleanup step.
