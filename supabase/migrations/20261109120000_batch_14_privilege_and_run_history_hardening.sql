-- Phase 4B Batch 14: remove unused authenticated table capabilities and make
-- the Batch D operational history tables deny-by-default at both privilege
-- and row-security layers. The owner verified the same direct-grant baseline
-- on Dev and Prod before this migration was written.

do $$
declare
  v_target record;
  v_effective boolean;
  v_has_any_direct boolean;
  v_has_approved_direct boolean;
  v_has_unapproved_direct boolean;
begin
  if current_user <> 'postgres' then
    raise exception 'Batch 14 privilege hardening must be applied by postgres; current_user is %.',
      current_user;
  end if;

  if not (
    pg_catalog.has_table_privilege('authenticated', 'public.events', 'SELECT')
    and pg_catalog.has_table_privilege('authenticated', 'public.events', 'INSERT')
    and pg_catalog.has_table_privilege('authenticated', 'public.events', 'UPDATE')
    and not pg_catalog.has_table_privilege('authenticated', 'public.events', 'DELETE')

    and pg_catalog.has_table_privilege('authenticated', 'public.tasks', 'SELECT')
    and pg_catalog.has_table_privilege('authenticated', 'public.tasks', 'INSERT')
    and pg_catalog.has_table_privilege('authenticated', 'public.tasks', 'UPDATE')
    and pg_catalog.has_table_privilege('authenticated', 'public.tasks', 'DELETE')

    and pg_catalog.has_table_privilege('authenticated', 'public.notifications', 'SELECT')
    and pg_catalog.has_table_privilege('authenticated', 'public.notifications', 'INSERT')
    and pg_catalog.has_table_privilege('authenticated', 'public.notifications', 'UPDATE')
    and pg_catalog.has_table_privilege('authenticated', 'public.notifications', 'DELETE')

    and pg_catalog.has_table_privilege('authenticated', 'public.users', 'SELECT')
    and not pg_catalog.has_table_privilege('authenticated', 'public.users', 'INSERT')
    and not pg_catalog.has_table_privilege('authenticated', 'public.users', 'UPDATE')
    and not pg_catalog.has_table_privilege('authenticated', 'public.users', 'DELETE')

    and not pg_catalog.has_table_privilege('authenticated', 'public.activity_log', 'SELECT')
    and not pg_catalog.has_table_privilege('authenticated', 'public.activity_log', 'INSERT')
    and not pg_catalog.has_table_privilege('authenticated', 'public.activity_log', 'UPDATE')
    and not pg_catalog.has_table_privilege('authenticated', 'public.activity_log', 'DELETE')
    and not pg_catalog.has_table_privilege('authenticated', 'public.activity_log', 'TRUNCATE')
    and not pg_catalog.has_table_privilege('authenticated', 'public.activity_log', 'REFERENCES')
    and not pg_catalog.has_table_privilege('authenticated', 'public.activity_log', 'TRIGGER')
  ) then
    raise exception 'Batch 14 stopped: authenticated table privileges differ from the owner-approved Dev/Prod preflight.';
  end if;

  if exists (
    with targets(table_name, privilege_type) as (
      values
        ('events', 'TRUNCATE'), ('events', 'REFERENCES'), ('events', 'TRIGGER'),
        ('tasks', 'TRUNCATE'), ('tasks', 'REFERENCES'), ('tasks', 'TRIGGER'),
        ('notifications', 'TRUNCATE'), ('notifications', 'REFERENCES'), ('notifications', 'TRIGGER'),
        ('users', 'TRUNCATE'), ('users', 'REFERENCES'), ('users', 'TRIGGER')
    )
    select 1
    from targets as target
    join pg_catalog.pg_class as class_row
      on class_row.relnamespace = 'public'::regnamespace
     and class_row.relname = target.table_name
    cross join lateral pg_catalog.aclexplode(
      coalesce(class_row.relacl, pg_catalog.acldefault('r', class_row.relowner))
    ) as acl_row
    where acl_row.privilege_type = target.privilege_type
      and (
        acl_row.grantee = 0
        or (
          acl_row.grantee <> 'authenticated'::regrole::oid
          and pg_catalog.pg_has_role('authenticated', acl_row.grantee, 'USAGE')
        )
      )
  ) then
    raise exception 'Batch 14 stopped: a targeted privilege is supplied by PUBLIC or an inherited role.';
  end if;

  for v_target in
    select *
    from (values
      ('events', 'TRUNCATE'), ('events', 'REFERENCES'), ('events', 'TRIGGER'),
      ('tasks', 'TRUNCATE'), ('tasks', 'REFERENCES'), ('tasks', 'TRIGGER'),
      ('notifications', 'TRUNCATE'), ('notifications', 'REFERENCES'), ('notifications', 'TRIGGER'),
      ('users', 'TRUNCATE'), ('users', 'REFERENCES'), ('users', 'TRIGGER')
    ) as targets(table_name, privilege_type)
  loop
    v_effective := pg_catalog.has_table_privilege(
      'authenticated',
      pg_catalog.format('public.%I', v_target.table_name),
      v_target.privilege_type
    );

    select
      coalesce(pg_catalog.bool_or(
        acl_row.grantee = 'authenticated'::regrole::oid
      ), false),
      coalesce(pg_catalog.bool_or(
        acl_row.grantee = 'authenticated'::regrole::oid
        and acl_row.grantor = 'postgres'::regrole::oid
        and not acl_row.is_grantable
      ), false),
      coalesce(pg_catalog.bool_or(
        acl_row.grantee = 'authenticated'::regrole::oid
        and (
          acl_row.grantor <> 'postgres'::regrole::oid
          or acl_row.is_grantable
        )
      ), false)
    into v_has_any_direct, v_has_approved_direct, v_has_unapproved_direct
    from pg_catalog.pg_class as class_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(class_row.relacl, pg_catalog.acldefault('r', class_row.relowner))
    ) as acl_row
    where class_row.relnamespace = 'public'::regnamespace
      and class_row.relname = v_target.table_name
      and acl_row.privilege_type = v_target.privilege_type;

    if v_effective then
      if not v_has_approved_direct or v_has_unapproved_direct then
        raise exception 'Batch 14 stopped: effective %.% must be a direct non-grantable authenticated grant from postgres.',
          v_target.table_name, v_target.privilege_type;
      end if;
    elsif v_has_any_direct then
      raise exception 'Batch 14 stopped: absent effective %.% still has a direct authenticated ACL entry.',
        v_target.table_name, v_target.privilege_type;
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_class as class_row
    where class_row.relnamespace = 'public'::regnamespace
      and class_row.relname in ('events', 'tasks', 'notifications', 'users', 'activity_log')
      and pg_catalog.pg_has_role('authenticated', class_row.relowner, 'USAGE')
  ) then
    raise exception 'Batch 14 stopped: authenticated inherits a targeted table owner.';
  end if;
end
$$;

revoke truncate, references, trigger
on table public.events, public.tasks, public.notifications, public.activity_log
from authenticated;

revoke truncate, references, trigger
on table public.users
from authenticated;

alter table ceit_connect_private.event_auto_archive_runs
enable row level security;

alter table ceit_connect_private.event_auto_archive_run_items
enable row level security;

do $$
declare
  v_private_table text;
  v_role text;
  v_privilege text;
begin
  if not (
    pg_catalog.has_table_privilege('authenticated', 'public.events', 'SELECT')
    and pg_catalog.has_table_privilege('authenticated', 'public.events', 'INSERT')
    and pg_catalog.has_table_privilege('authenticated', 'public.events', 'UPDATE')
    and not pg_catalog.has_table_privilege('authenticated', 'public.events', 'DELETE')
    and not pg_catalog.has_table_privilege('authenticated', 'public.events', 'TRUNCATE')
    and not pg_catalog.has_table_privilege('authenticated', 'public.events', 'REFERENCES')
    and not pg_catalog.has_table_privilege('authenticated', 'public.events', 'TRIGGER')

    and pg_catalog.has_table_privilege('authenticated', 'public.tasks', 'SELECT')
    and pg_catalog.has_table_privilege('authenticated', 'public.tasks', 'INSERT')
    and pg_catalog.has_table_privilege('authenticated', 'public.tasks', 'UPDATE')
    and pg_catalog.has_table_privilege('authenticated', 'public.tasks', 'DELETE')
    and not pg_catalog.has_table_privilege('authenticated', 'public.tasks', 'TRUNCATE')
    and not pg_catalog.has_table_privilege('authenticated', 'public.tasks', 'REFERENCES')
    and not pg_catalog.has_table_privilege('authenticated', 'public.tasks', 'TRIGGER')

    and pg_catalog.has_table_privilege('authenticated', 'public.notifications', 'SELECT')
    and pg_catalog.has_table_privilege('authenticated', 'public.notifications', 'INSERT')
    and pg_catalog.has_table_privilege('authenticated', 'public.notifications', 'UPDATE')
    and pg_catalog.has_table_privilege('authenticated', 'public.notifications', 'DELETE')
    and not pg_catalog.has_table_privilege('authenticated', 'public.notifications', 'TRUNCATE')
    and not pg_catalog.has_table_privilege('authenticated', 'public.notifications', 'REFERENCES')
    and not pg_catalog.has_table_privilege('authenticated', 'public.notifications', 'TRIGGER')

    and pg_catalog.has_table_privilege('authenticated', 'public.users', 'SELECT')
    and not pg_catalog.has_table_privilege('authenticated', 'public.users', 'INSERT')
    and not pg_catalog.has_table_privilege('authenticated', 'public.users', 'UPDATE')
    and not pg_catalog.has_table_privilege('authenticated', 'public.users', 'DELETE')
    and not pg_catalog.has_table_privilege('authenticated', 'public.users', 'TRUNCATE')
    and not pg_catalog.has_table_privilege('authenticated', 'public.users', 'REFERENCES')
    and not pg_catalog.has_table_privilege('authenticated', 'public.users', 'TRIGGER')

    and not pg_catalog.has_table_privilege('authenticated', 'public.activity_log', 'SELECT')
    and not pg_catalog.has_table_privilege('authenticated', 'public.activity_log', 'INSERT')
    and not pg_catalog.has_table_privilege('authenticated', 'public.activity_log', 'UPDATE')
    and not pg_catalog.has_table_privilege('authenticated', 'public.activity_log', 'DELETE')
    and not pg_catalog.has_table_privilege('authenticated', 'public.activity_log', 'TRUNCATE')
    and not pg_catalog.has_table_privilege('authenticated', 'public.activity_log', 'REFERENCES')
    and not pg_catalog.has_table_privilege('authenticated', 'public.activity_log', 'TRIGGER')
  ) then
    raise exception 'Batch 14 privilege hardening did not produce the exact approved authenticated privilege matrix.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class as class_row
    where class_row.oid in (
      'public.events'::regclass,
      'public.tasks'::regclass,
      'public.notifications'::regclass,
      'public.users'::regclass,
      'public.activity_log'::regclass
    )
      and not class_row.relrowsecurity
  ) then
    raise exception 'Batch 14 expected RLS to remain enabled on every hardened public table.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class as class_row
    where class_row.oid in (
      'ceit_connect_private.event_auto_archive_runs'::regclass,
      'ceit_connect_private.event_auto_archive_run_items'::regclass
    )
      and (not class_row.relrowsecurity or class_row.relforcerowsecurity)
  ) then
    raise exception 'Batch 14 private run-history RLS state is invalid.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policy as policy_row
    where policy_row.polrelid in (
      'ceit_connect_private.event_auto_archive_runs'::regclass,
      'ceit_connect_private.event_auto_archive_run_items'::regclass
    )
  ) then
    raise exception 'Batch 14 private run-history tables must have zero policies.';
  end if;

  foreach v_private_table in array array[
    'ceit_connect_private.event_auto_archive_runs',
    'ceit_connect_private.event_auto_archive_run_items'
  ] loop
    foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
      foreach v_privilege in array array[
        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
      ] loop
        if pg_catalog.has_table_privilege(v_role, v_private_table, v_privilege) then
          raise exception 'Batch 14 private table access remains: role %, table %, privilege %.',
            v_role, v_private_table, v_privilege;
        end if;
      end loop;
    end loop;
  end loop;
end
$$;

comment on table ceit_connect_private.event_auto_archive_runs is
  'Batch D operational automatic-archive runs. Batch 14 enables non-forced RLS with zero policies in addition to zero application-role grants.';

comment on table ceit_connect_private.event_auto_archive_run_items is
  'Batch D operational automatic-archive outcomes. event_id deliberately has no event FK; Batch 14 enables non-forced RLS with zero policies in addition to zero application-role grants.';
