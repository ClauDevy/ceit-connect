# Phase 5 Step B — last active Admin guard

**Status:** Implemented locally; not applied to Dev or Prod.

## Contract

CEIT Connect must retain at least one active Admin. For this invariant, an
active Admin is a `public.users` row with `role = 'Admin'`, `is_active = true`,
and `anonymized_at is null`, joined to an `auth.users` row whose
`email_confirmed_at is not null`. This is exactly
`get_admin_lifecycle_context().confirmed_active_admin_count`; the separate
`active_admin_count` intentionally omits Auth confirmation for seat-capacity
display and is not used by this guard.

The guard applies to every `public.users` update, including postgres and
service-role writes, and has no writer-marker bypass. It fires only when the
OLD row met the definition, the NEW row does not, and the resulting confirmed
active Admin count is zero. A grandfathered database already at zero may still
receive zero-to-zero and unrelated changes.

Directly clearing `auth.users.email_confirmed_at` is an unsupported writer
outside this public-table guard. No supported application path does that, and a
source contract scans non-test `src/` files, including Auth admin mutation
calls, to prevent such a writer from being introduced.

The supported isolation level for protected Admin changes is `read committed`.
The statement lock guard rejects every other transaction isolation level with
`CCG03`. App routes use the normal read-committed connection behavior, so this
code is unreachable from app routes and needs no route error mapping.

## Writer and lock audit

No current writer takes a `public.users` row lock or a task-assignee user lock
before the officer advisory lock. `→` below is acquisition order.

| Writer | Current effect on protected columns | Lock order and last-Admin result |
| --- | --- | --- |
| Raw postgres/service-role `UPDATE` | Can name `role`, `is_active`, `anonymized_at`, or `committee_id`; ordinary service-role officer changes are also rejected by `users_guard_officer_writes`. | New BEFORE statement trigger: officer advisory → target user rows → existing BEFORE row guards → new AFTER row guard. No bypass. |
| Authenticated raw update | None: authenticated `INSERT/UPDATE/DELETE` grants are revoked and no update policy remains. | Permission denial occurs before triggers. Contract coverage pins the revocation. |
| `toggle-user-active` direct Member update | Service-role update of `is_active`, selected after a caller-session role read. | New BEFORE statement trigger: officer advisory → target row. A role race that reaches the update is stopped by the guards and maps safely. |
| `set_officer_active` | Changes `is_active` for an Admin/Co-Admin. `CCO05` already refuses final confirmed-Admin deactivation. | Authorize/self-check → officer advisory → reauthorize → sorted task-assignee user locks → target user row → re-entrant statement lock → AFTER guard. `CCO05` remains first. |
| `step_down_as_admin` | Changes the caller Admin to Member and sets committee. `CCO09` already protects the last confirmed active Admin. | Officer advisory → authorize → target user row → re-entrant statement lock → AFTER guard. `CCO09` remains first. |
| `appoint_member_as_officer` | Member → Admin/Co-Admin; can only add an Admin. | Officer advisory → authorize → sorted task-assignee user locks → target user row → re-entrant statement lock → AFTER guard. |
| `return_coadmin_to_member` | Co-Admin → Member and committee change; cannot target an Admin. | Officer advisory → authorize → sorted task-assignee user locks → target user row → re-entrant statement lock → AFTER guard. |
| `move_member_to_committee` | Member committee only. Committee is not part of active-Admin qualification. | Officer advisory → authorize → sorted task-assignee user locks → target user row → re-entrant statement lock; AFTER WHEN is false. |
| `invite_new_officer` finalization | Inserts a new Admin/Co-Admin; does not remove one. | Authorize → officer advisory → reauthorize → invite row → users insert. The new guard is UPDATE-only. |
| `cancel_officer_invite` | May deactivate only an unconfirmed pending officer profile, already excluded from the invariant. | Officer advisory → authorize → invite row → re-entrant statement lock → user row; AFTER function confirms OLD was not qualifying. |
| `finalize_member_invite` | Inserts only a Member. | Authorize → officer advisory → reauthorize → users insert. No protected Admin is reduced. |
| `deactivate_committee_member` | Same-committee Member only. | Authorize → officer advisory → reauthorize → target user row → re-entrant statement lock; AFTER WHEN is false. |
| `reactivate_committee_member` | Same-committee Member only. | Authorize → officer advisory → reauthorize → sorted task-assignee user locks → target user row → re-entrant statement lock; AFTER WHEN is false. |
| `anonymize_former_member` | Requires an already inactive target; Batch A permits an inactive peer Admin. | Authorize/self-check → officer advisory → reauthorize → sorted task-assignee user locks → target user row → re-entrant statement lock. An active raw anonymization is stopped by `CCG02`; the normal inactive path remains valid. |
| `update_own_profile`, committee name update, set-password, complete-reset | Name or `password_set` only. | They do not name protected columns, so the statement lock trigger does not fire. |
| Public/Auth hard delete | Existing `users_guard_officer_writes` unconditionally raises `CCO08`; Auth cascade deletion of a profile reaches the same block. | No new lock is needed because deletion never proceeds. Invite cleanup deletes only unfinalized Auth users without profiles. |

The statement trigger uses the established officer advisory key, so it composes
with officer-seat work and does not add an order relative to event locks. The
AFTER row trigger is deliberately later than `users_guard_officer_writes` and
`users_guard_president_committee`. A multi-row update that demotes all Admins
sees the statement's earlier row changes and fails on the row that would leave
zero; the exception rolls back the whole statement.

If PostgreSQL nevertheless detects a deadlock, it aborts one entire transaction
with SQLSTATE `40P01`; no partial user change commits. Existing route fallbacks
return fixed retry-safe text, client mutation state clears in `finally`, and a
user can retry. No raw database message is exposed.

## Error and UI behavior

- Universal guard: `CCG02 — At least one active Admin is required.`
- Isolation guard: `CCG03 — Admin changes require read committed isolation.` It
  is unreachable from app routes, which use read committed, so it has no route
  error mapping.
- Existing peer deactivation: `CCO05` remains unchanged and wins before UPDATE.
- Existing self-step-down: `CCO09` remains unchanged and wins before UPDATE.
- Officer, member-management, toggle, transition, and removal boundaries map
  `CCG02` to the fixed message.
- User Management uses the existing confirmed count. A sole active Admin has
  no step-down/deactivate action and sees the fixed explanation.
- `Checking Admin safeguards…` appears only on Admin rows. Member and Co-Admin
  actions, including Co-Admin-viewer behavior, remain unchanged.
- If that Admin-only lifecycle read fails or returns no row, the protected
  Admin actions stay hidden and the row says `Could not check Admin safeguards.
  Refresh the page to try again.` There is no retry control or retry loop.

## Migration

```sql
-- Preserve at least one confirmed, active, non-anonymized Admin for every
-- public.users writer. The statement trigger takes the established officer
-- advisory lock before UPDATE can lock any target users row. The AFTER row
-- trigger then evaluates the statement's resulting rows without creating the
-- officer-lock -> users-row inversion used by approved officer writers.

create function public.lock_last_active_admin_updates()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using
      errcode = 'CCG03',
      message = 'Admin changes require read committed isolation.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    public.officer_advisory_lock_key()
  );
  return null;
end;
$$;

alter function public.lock_last_active_admin_updates() owner to postgres;
revoke all on function public.lock_last_active_admin_updates()
from public, anon, authenticated, service_role;

create trigger users_lock_last_active_admin_updates
before update of role, is_active, anonymized_at, committee_id
on public.users
for each statement execute function public.lock_last_active_admin_updates();

create function public.guard_last_active_admin()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if old.role is distinct from 'Admin'
     or old.is_active is not true
     or old.anonymized_at is not null
     or not exists (
       select 1
       from auth.users as auth_user
       where auth_user.id = old.id
         and auth_user.email_confirmed_at is not null
     ) then
    return null;
  end if;

  if new.role = 'Admin'
     and new.is_active
     and new.anonymized_at is null
     and exists (
       select 1
       from auth.users as auth_user
       where auth_user.id = new.id
         and auth_user.email_confirmed_at is not null
     ) then
    return null;
  end if;

  if not exists (
    select 1
    from public.users as profile
    join auth.users as auth_user on auth_user.id = profile.id
    where profile.role = 'Admin'
      and profile.is_active
      and profile.anonymized_at is null
      and auth_user.email_confirmed_at is not null
  ) then
    raise exception using
      errcode = 'CCG02',
      message = 'At least one active Admin is required.';
  end if;

  return null;
end;
$$;

alter function public.guard_last_active_admin() owner to postgres;
revoke all on function public.guard_last_active_admin()
from public, anon, authenticated, service_role;

create trigger users_guard_last_active_admin
after update of role, is_active, anonymized_at, committee_id
on public.users
for each row
when (
  old.role = 'Admin'
  and old.is_active
  and old.anonymized_at is null
  and (
    new.role is distinct from old.role
    or new.is_active is distinct from old.is_active
    or new.anonymized_at is distinct from old.anonymized_at
  )
)
execute function public.guard_last_active_admin();
```

No existing function is replaced.

## Prod preflight

Run this read-only paste in the Prod SQL Editor before applying the migration.
It returns only the confirmed active Admin count and names.

```sql
select
  pg_catalog.count(*)::integer as confirmed_active_admin_count,
  coalesce(
    pg_catalog.array_agg(profile.full_name order by profile.full_name),
    array[]::text[]
  ) as active_admin_names
from public.users as profile
join auth.users as auth_user on auth_user.id = profile.id
where profile.role = 'Admin'
  and profile.is_active
  and profile.anonymized_at is null
  and auth_user.email_confirmed_at is not null;
```

Stop if the count is zero. Do not apply or test the migration until the Admin
state is repaired through an approved owner process.

## Dev verification — 19/19

Dev only. In the Dev SQL Editor, select **Run without RLS** and paste the whole
block. It creates its own Auth/profile/committee fixtures, temporarily excludes
pre-existing Admins from the test count inside the rollback-only transaction,
prints a plain results table, and ends with the intentional
`TEST RESULTS 19/19 PASS` exception. It creates no temp table and does not touch
`storage.objects`.

```sql
begin;

create table public.step_b_last_admin_test_results (
  label text primary key,
  passed boolean not null
);
grant insert, select on public.step_b_last_admin_test_results to authenticated;

create function pg_temp.ok(p_label text, p_passed boolean)
returns void language plpgsql as $$
begin
  insert into public.step_b_last_admin_test_results(label, passed)
  values (p_label, coalesce(p_passed, false));
end;
$$;

create function pg_temp.auth_as(p_user uuid)
returns void language plpgsql as $$
begin
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', p_user::text,
      'role', 'authenticated'
    )::text,
    true
  );
  perform pg_catalog.set_config('request.jwt.claim.sub', p_user::text, true);
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
end;
$$;

do $fixtures$
begin
  update auth.users as auth_user
  set email_confirmed_at = null
  where exists (
    select 1 from public.users as profile
    where profile.id = auth_user.id and profile.role = 'Admin'
  );

  update public.app_settings
  set enforce_officer_role_caps = false
  where key = 'global';

  insert into public.committees(id, name) values
    ('b200c000-0000-4000-8000-000000000001', 'Step B Committee A'),
    ('b200c000-0000-4000-8000-000000000002', 'Step B Committee B');

  insert into auth.users(
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values
    ('b2000000-0000-4000-8000-000000000001',
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'step-b-admin-1@example.test', '',
      now(), '{}', '{}', now(), now()),
    ('b2000000-0000-4000-8000-000000000002',
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'step-b-admin-2@example.test', '',
      now(), '{}', '{}', now(), now()),
    ('b2000000-0000-4000-8000-000000000003',
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'step-b-unconfirmed@example.test', '',
      null, '{}', '{}', now(), now()),
    ('b2000000-0000-4000-8000-000000000004',
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'step-b-member@example.test', '',
      now(), '{}', '{}', now(), now());

  perform pg_catalog.set_config(
    'ceit_connect.officer_writer', 'invite_new_officer', true
  );
  insert into public.users(
    id, email, full_name, role, committee_id, is_active
  ) values
    ('b2000000-0000-4000-8000-000000000001',
      'step-b-admin-1@example.test', 'Step B Admin One', 'Admin', null, true),
    ('b2000000-0000-4000-8000-000000000002',
      'step-b-admin-2@example.test', 'Step B Admin Two', 'Admin', null, false),
    ('b2000000-0000-4000-8000-000000000003',
      'step-b-unconfirmed@example.test', 'Step B Unconfirmed Admin',
      'Admin', null, true);
  perform pg_catalog.set_config('ceit_connect.officer_writer', '', true);

  insert into public.users(
    id, email, full_name, role, committee_id, is_active
  ) values (
    'b2000000-0000-4000-8000-000000000004',
    'step-b-member@example.test', 'Step B Member', 'Member',
    'b200c000-0000-4000-8000-000000000001', true
  );

  set constraints all immediate;
end;
$fixtures$;

do $catalog$
declare
  lock_proc pg_catalog.pg_proc%rowtype;
  guard_proc pg_catalog.pg_proc%rowtype;
  officer_guard pg_catalog.pg_proc%rowtype;
  before_names text[];
begin
  select procedure_row.* into lock_proc
  from pg_catalog.pg_proc as procedure_row
  where procedure_row.oid =
    'public.lock_last_active_admin_updates()'::pg_catalog.regprocedure;

  select procedure_row.* into guard_proc
  from pg_catalog.pg_proc as procedure_row
  where procedure_row.oid =
    'public.guard_last_active_admin()'::pg_catalog.regprocedure;

  select procedure_row.* into officer_guard
  from pg_catalog.pg_proc as procedure_row
  where procedure_row.oid =
    'public.guard_officer_user_writes()'::pg_catalog.regprocedure;

  select pg_catalog.array_agg(trigger_row.tgname::text order by trigger_row.tgname)
  into before_names
  from pg_catalog.pg_trigger as trigger_row
  where trigger_row.tgrelid = 'public.users'::pg_catalog.regclass
    and trigger_row.tgname in (
      'users_guard_officer_writes',
      'users_guard_president_committee'
    )
    and not trigger_row.tgisinternal
    and (trigger_row.tgtype::integer & 2) = 2;

  perform pg_temp.ok('01 guard functions have exact metadata',
    pg_catalog.pg_get_userbyid(lock_proc.proowner) = 'postgres'
    and lock_proc.prosecdef and lock_proc.provolatile = 'v'
    and lock_proc.proconfig = array['search_path=""']::text[]
    and pg_catalog.pg_get_userbyid(guard_proc.proowner) = 'postgres'
    and guard_proc.prosecdef and guard_proc.provolatile = 'v'
    and guard_proc.proconfig = array['search_path=""']::text[]);

  perform pg_temp.ok('02 guard functions have no callable grants',
    not pg_catalog.has_function_privilege('public', lock_proc.oid, 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', lock_proc.oid, 'EXECUTE')
    and not pg_catalog.has_function_privilege('authenticated', lock_proc.oid, 'EXECUTE')
    and not pg_catalog.has_function_privilege('service_role', lock_proc.oid, 'EXECUTE')
    and not pg_catalog.has_function_privilege('public', guard_proc.oid, 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', guard_proc.oid, 'EXECUTE')
    and not pg_catalog.has_function_privilege('authenticated', guard_proc.oid, 'EXECUTE')
    and not pg_catalog.has_function_privilege('service_role', guard_proc.oid, 'EXECUTE'));

  perform pg_temp.ok('03 lock trigger is BEFORE UPDATE statement level',
    exists(
      select 1 from pg_catalog.pg_trigger as trigger_row
      where trigger_row.tgrelid = 'public.users'::pg_catalog.regclass
        and trigger_row.tgname = 'users_lock_last_active_admin_updates'
        and not trigger_row.tgisinternal
        and (trigger_row.tgtype::integer & 2) = 2
        and (trigger_row.tgtype::integer & 16) = 16
        and (trigger_row.tgtype::integer & 1) = 0
        and pg_catalog.pg_get_triggerdef(trigger_row.oid)
          like '%BEFORE UPDATE OF role, is_active, anonymized_at, committee_id%FOR EACH STATEMENT%'));

  perform pg_temp.ok('04 invariant trigger is AFTER UPDATE row level',
    exists(
      select 1 from pg_catalog.pg_trigger as trigger_row
      where trigger_row.tgrelid = 'public.users'::pg_catalog.regclass
        and trigger_row.tgname = 'users_guard_last_active_admin'
        and not trigger_row.tgisinternal
        and (trigger_row.tgtype::integer & 2) = 0
        and (trigger_row.tgtype::integer & 16) = 16
        and (trigger_row.tgtype::integer & 1) = 1
        and pg_catalog.pg_get_triggerdef(trigger_row.oid)
          like '%AFTER UPDATE OF role, is_active, anonymized_at, committee_id%FOR EACH ROW%'));

  perform pg_temp.ok('05 existing BEFORE guards precede the new AFTER guard',
    before_names = array[
      'users_guard_officer_writes',
      'users_guard_president_committee'
    ]::text[]
    and exists(
      select 1 from pg_catalog.pg_trigger as trigger_row
      where trigger_row.tgrelid = 'public.users'::pg_catalog.regclass
        and trigger_row.tgname = 'users_guard_last_active_admin'
        and (trigger_row.tgtype::integer & 2) = 0));

  perform pg_temp.ok('06 function bodies pin lock definition and no bypass',
    lock_proc.prosrc like '%public.officer_advisory_lock_key()%'
    and lock_proc.prosrc like '%pg_catalog.current_setting(''transaction_isolation'') is distinct from ''read committed''%'
    and lock_proc.prosrc like '%CCG03%'
    and lock_proc.prosrc like '%Admin changes require read committed isolation.%'
    and guard_proc.prosrc like '%auth_user.email_confirmed_at is not null%'
    and guard_proc.prosrc like '%CCG02%'
    and guard_proc.prosrc like '%At least one active Admin is required.%'
    and guard_proc.prosrc not like '%session_user%'
    and guard_proc.prosrc not like '%service_role%'
    and guard_proc.prosrc not like '%current_user%');

  perform pg_temp.ok('07 hard delete and raw authenticated denial remain',
    officer_guard.prosrc like '%User profiles cannot be deleted.%'
    and not pg_catalog.has_table_privilege('authenticated', 'public.users', 'INSERT')
    and not pg_catalog.has_table_privilege('authenticated', 'public.users', 'UPDATE')
    and not pg_catalog.has_table_privilege('authenticated', 'public.users', 'DELETE'));
end;
$catalog$;

do $definition$
begin
  perform pg_temp.ok('08 unconfirmed Admin does not count',
    (select pg_catalog.count(*) = 1
     from public.users as profile
     join auth.users as auth_user on auth_user.id = profile.id
     where profile.role = 'Admin'
       and profile.is_active
       and profile.anonymized_at is null
       and auth_user.email_confirmed_at is not null));
end;
$definition$;

do $raw_guards$
declare
  denied boolean;
begin
  perform pg_catalog.set_config(
    'ceit_connect.officer_writer', 'set_officer_active', true
  );
  denied := false;
  begin
    update public.users set is_active = false
    where id = 'b2000000-0000-4000-8000-000000000001';
  exception when others then
    denied := sqlstate = 'CCG02'
      and sqlerrm = 'At least one active Admin is required.';
  end;
  perform pg_temp.ok('09 raw privileged deactivation fails CCG02', denied);
  perform pg_catalog.set_config('ceit_connect.officer_writer', '', true);

  perform pg_catalog.set_config(
    'ceit_connect.officer_writer', 'step_down_as_admin', true
  );
  denied := false;
  begin
    update public.users set role = 'Member'
    where id = 'b2000000-0000-4000-8000-000000000001';
  exception when others then
    denied := sqlstate = 'CCG02';
  end;
  perform pg_temp.ok('10 raw privileged demotion fails CCG02', denied);
  perform pg_catalog.set_config('ceit_connect.officer_writer', '', true);

  perform pg_catalog.set_config(
    'ceit_connect.officer_writer', 'set_officer_active', true
  );
  perform pg_catalog.set_config(
    'ceit_connect.former_member_writer', 'anonymize_former_member', true
  );
  denied := false;
  begin
    update public.users as profile
    set email = profile.id::text || '@former.invalid',
        full_name = 'Former member',
        avatar_url = null,
        discord_id = null,
        is_active = false,
        anonymized_at = now()
    where profile.id = 'b2000000-0000-4000-8000-000000000001';
  exception when others then
    denied := sqlstate = 'CCG02';
  end;
  perform pg_temp.ok('11 raw active anonymize path fails CCG02', denied);
  perform pg_catalog.set_config('ceit_connect.former_member_writer', '', true);
  perform pg_catalog.set_config('ceit_connect.officer_writer', '', true);
end;
$raw_guards$;

select pg_temp.auth_as('b2000000-0000-4000-8000-000000000003');
set local role authenticated;

do $cco05$
declare denied boolean := false;
begin
  begin
    perform public.set_officer_active(
      'b2000000-0000-4000-8000-000000000001', false
    );
  exception when others then
    denied := sqlstate = 'CCO05'
      and sqlerrm = 'At least one other active confirmed Admin is required.';
  end;
  perform pg_temp.ok('12 CCO05 still wins before CCG02', denied);
end;
$cco05$;

reset role;
select pg_temp.auth_as('b2000000-0000-4000-8000-000000000001');
set local role authenticated;

do $cco09$
declare denied boolean := false;
begin
  begin
    perform public.step_down_as_admin(
      'b200c000-0000-4000-8000-000000000001'
    );
  exception when others then
    denied := sqlstate = 'CCO09'
      and sqlerrm = 'The last active Admin cannot step down.';
  end;
  perform pg_temp.ok('13 CCO09 still wins before CCG02', denied);
end;
$cco09$;

reset role;

do $delete_guard$
declare denied boolean := false;
begin
  begin
    delete from public.users
    where id = 'b2000000-0000-4000-8000-000000000001';
  exception when others then
    denied := sqlstate = 'CCO08';
  end;
  perform pg_temp.ok('14 hard delete remains blocked by CCO08', denied);
end;
$delete_guard$;

do $grandfather$
begin
  update auth.users set email_confirmed_at = null
  where id = 'b2000000-0000-4000-8000-000000000001';

  perform pg_catalog.set_config(
    'ceit_connect.officer_writer', 'set_officer_active', true
  );
  update public.users set is_active = false
  where id = 'b2000000-0000-4000-8000-000000000001';
  perform pg_temp.ok('15 zero-to-zero grandfathered update is allowed',
    exists(
      select 1 from public.users
      where id = 'b2000000-0000-4000-8000-000000000001'
        and not is_active));

  update public.users set is_active = true
  where id = 'b2000000-0000-4000-8000-000000000001';
  perform pg_catalog.set_config('ceit_connect.officer_writer', '', true);
  update auth.users set email_confirmed_at = now()
  where id = 'b2000000-0000-4000-8000-000000000001';
end;
$grandfather$;

do $multirow$
declare denied boolean := false;
begin
  perform pg_catalog.set_config(
    'ceit_connect.officer_writer', 'set_officer_active', true
  );
  update public.users set is_active = true
  where id = 'b2000000-0000-4000-8000-000000000002';
  perform pg_catalog.set_config(
    'ceit_connect.officer_writer', 'step_down_as_admin', true
  );
  begin
    update public.users set role = 'Member'
    where id in (
      'b2000000-0000-4000-8000-000000000001',
      'b2000000-0000-4000-8000-000000000002'
    );
  exception when others then
    denied := sqlstate = 'CCG02';
  end;
  perform pg_catalog.set_config('ceit_connect.officer_writer', '', true);

  perform pg_temp.ok('16 one UPDATE demoting all Admins fails CCG02',
    denied
    and (select pg_catalog.count(*) = 2 from public.users
         where id in (
           'b2000000-0000-4000-8000-000000000001',
           'b2000000-0000-4000-8000-000000000002'
         ) and role = 'Admin' and is_active));
end;
$multirow$;

select pg_temp.auth_as('b2000000-0000-4000-8000-000000000001');
set local role authenticated;

do $nonlast_and_anonymize$
declare result_row record;
begin
  perform public.set_officer_active(
    'b2000000-0000-4000-8000-000000000002', false
  );
  perform pg_temp.ok('17 non-last Admin deactivation still succeeds',
    exists(
      select 1 from public.users
      where id = 'b2000000-0000-4000-8000-000000000002'
        and role = 'Admin' and not is_active));

  select * into result_row
  from public.anonymize_former_member(
    'b2000000-0000-4000-8000-000000000002'
  );
  perform pg_temp.ok('18 inactive non-last Admin anonymize path still succeeds',
    result_row.out_outcome = 'anonymized'
    and exists(
      select 1 from public.users
      where id = 'b2000000-0000-4000-8000-000000000002'
        and anonymized_at is not null
        and not is_active));
end;
$nonlast_and_anonymize$;

reset role;

do $member_committee$
begin
  perform pg_catalog.set_config(
    'ceit_connect.officer_writer', 'move_member_to_committee', true
  );
  update public.users set committee_id = 'b200c000-0000-4000-8000-000000000002'
  where id = 'b2000000-0000-4000-8000-000000000004';
  perform pg_catalog.set_config('ceit_connect.officer_writer', '', true);
  perform pg_temp.ok('19 non-Admin committee update is unaffected',
    exists(
      select 1 from public.users
      where id = 'b2000000-0000-4000-8000-000000000004'
        and role = 'Member'
        and committee_id = 'b200c000-0000-4000-8000-000000000002'));
end;
$member_committee$;

set constraints all immediate;

select label, passed
from public.step_b_last_admin_test_results
order by label;

do $finish$
declare
  passed_count integer;
  total_count integer;
  failed_labels text;
begin
  select pg_catalog.count(*)::integer,
         pg_catalog.count(*) filter (where result.passed)::integer,
         pg_catalog.string_agg(result.label, ', ' order by result.label)
           filter (where not result.passed)
  into total_count, passed_count, failed_labels
  from public.step_b_last_admin_test_results as result;

  if total_count = 19 and passed_count = 19 then
    raise exception 'TEST RESULTS 19/19 PASS (intentional rollback)';
  end if;

  raise exception 'TEST RESULTS %/19 PASS; FAILED: % (intentional rollback)',
    passed_count,
    coalesce(
      failed_labels,
      pg_catalog.format('no failed labels recorded; result count was %s', total_count)
    );
end;
$finish$;

rollback;
```

## Manual UI checks

1. With one confirmed active Admin, open User Management as that Admin on
   desktop and phone. Confirm the Admin row explains the safeguard and offers
   no step-down action.
2. Confirm Member and Co-Admin row actions appear immediately and behave as
   before; no Admin-safeguard loading text appears on those rows.
3. With two confirmed active Admins, confirm self-step-down and peer deactivate
   are offered as before.
4. In both themes and reduced motion, confirm the explanation is readable and
   menus/dialogs retain their existing final state and motion behavior.

## Rollout

The owner applies the tracked migration to Dev, runs the 19-result paste, runs
the UI checks, and only then repeats the read-only preflight and approved
migration process for Prod. No command in this implementation applies or links
a Supabase project.
