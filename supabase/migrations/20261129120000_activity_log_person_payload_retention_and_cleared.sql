begin;

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Activity Log backup and clearing migration must be applied by postgres; current_user is %.',
      current_user;
  end if;
end
$$;

alter table public.activity_log
  drop constraint activity_log_person_payload_check,
  add constraint activity_log_person_payload_check
    check (
      activity_type is null
      or subject_kind <> 'person'
      or coalesce((
        (
          activity_type not in (
            'activity_log_retention_changed',
            'activity_log_cleared'
          )
          and pg_catalog.jsonb_typeof(changes) = 'object'
          and changes ? 'old_committee_id'
          and changes ? 'new_committee_id'
          and pg_catalog.jsonb_typeof(changes -> 'target_role') = 'string'
          and changes ->> 'target_role' in ('Admin', 'Co-Admin', 'Member')
          and (
            changes -> 'old_committee_id' = 'null'::jsonb
            or (changes ->> 'old_committee_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          )
          and (
            changes -> 'new_committee_id' = 'null'::jsonb
            or (changes ->> 'new_committee_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          )
        )
        or (
          activity_type = 'activity_log_retention_changed'
          and pg_catalog.jsonb_typeof(changes) = 'object'
          and changes ?& array['old_days', 'new_days']
          and (changes - 'old_days' - 'new_days') = '{}'::jsonb
          and pg_catalog.jsonb_typeof(changes -> 'old_days') = 'number'
          and pg_catalog.jsonb_typeof(changes -> 'new_days') = 'number'
          and (changes ->> 'old_days') ~ '^(3[0-9]|[4-9][0-9]|[1-6][0-9]{2}|7[0-2][0-9]|730)$'
          and (changes ->> 'new_days') ~ '^(3[0-9]|[4-9][0-9]|[1-6][0-9]{2}|7[0-2][0-9]|730)$'
        )
        or (
          activity_type = 'activity_log_cleared'
          and pg_catalog.jsonb_typeof(changes) = 'object'
          and changes ?& array['count', 'backup_id', 'cutoff_at']
          and (changes - 'count' - 'backup_id' - 'cutoff_at') = '{}'::jsonb
          and pg_catalog.jsonb_typeof(changes -> 'count') = 'number'
          and pg_catalog.jsonb_typeof(changes -> 'backup_id') = 'string'
          and (changes ->> 'backup_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and pg_catalog.jsonb_typeof(changes -> 'cutoff_at') = 'string'
        )
      ), false)
    );

commit;
