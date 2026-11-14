# V1(b) — President committee Admin guard

## Status and Prod preflight

This batch is implemented locally for owner review. Migration
`20261121140000_president_committee_admin_guard.sql` is not applied by Codex.

The owner ran the read-only Prod preflight before implementation and reported:

- canonical `President` lookup count: **1**;
- existing conflicts: **1 active Member** assigned to President;
- finalize-capable conflicting officer invitations: **0**.

The migration does not change that legacy row. It grandfathers only updates
whose `role` and `committee_id` are both unchanged, so the account can still be
renamed, deactivated, reactivated, and anonymized. Moving that person out of
President with the existing **Move member** action is a separate owner decision
after rollout.

## Rule and lookup

The fixed denial is SQLSTATE `CCG01` with exactly:

> Only Admins can be assigned to the President committee.

The canonical lookup is the exact, case-sensitive committee name `President`.
UUIDs differ by environment and the schema has no committee slug. The unique
name constraint prevents a second exact `President`, but a rename would make
the name-based guard stop recognizing the former row. A case-different name is
also noncanonical. Slug or rename protection is deferred to a separate batch.

## Enforcement

`users_guard_president_committee` sorts after
`users_guard_officer_writes`. The existing trigger therefore retains first
authority over writer authorization and still returns `CCO08` for an
unauthorized role/committee write. The new fixed-empty-path, postgres-owned
definer trigger then checks the complete `NEW` row for INSERT and UPDATE.

An invalid UPDATE is grandfathered only when both protected fields are
unchanged from an already-invalid `OLD` row. Every new President assignment,
move to President, or role change/demotion that leaves President assigned is
rejected.

`invite_new_officer` retains the latest 20261026120000 body with exactly two
changes: its first active-Admin authorization moves before the advisory lock
and repeats after waiting, and preparation rejects a non-Admin President
selection before writing `officer_invites`. The users trigger separately stops
any legacy invalid preparation at finalization.

The app maps `CCG01` to the same plain wording for Member invites, officer
invites, and all four officer transitions. Officer finalization still runs its
existing cancellation and Auth cleanup before returning the fixed wording.

## Writer result

The latest repository definitions were checked, including every replacement
body in migration order:

| Writer | Guard interaction | App-visible result |
| --- | --- | --- |
| `finalize_member_invite` | Its existing insert reaches both users triggers. An unauthorized protected insert still fails first with `CCO08`; an authorized non-Admin President insert fails with `CCG01`. | `/api/invite` maps `CCG01` to the fixed plain wording and still removes the unfinalized Auth user. |
| `invite_new_officer` preparation | The replacement is the 20261026120000 body plus only the first-authorization/relock reorder and one pre-write President block. A non-Admin President reservation fails with `CCG01`. | `/api/invite-officers` returns the fixed wording without sending an Auth invitation. |
| `invite_new_officer` finalization | A legacy preparing invite can reach the users insert, where the new trigger fails with `CCG01`. | `/api/invite-officers` still cancels the reservation and attempts Auth cleanup before returning the fixed wording. |
| `appoint_member_as_officer` | Appointing a Member as Admin remains valid; any resulting non-Admin President row fails with `CCG01`. | The officer-transition route returns HTTP 409 with the fixed wording. |
| `return_coadmin_to_member` | Returning a President Co-Admin to Member is a role change that leaves President assigned, so it fails with `CCG01`; non-President returns are unchanged. | The officer-transition route returns HTTP 409 with the fixed wording. |
| `move_member_to_committee` | Moving a non-Admin into President fails with `CCG01`; moves elsewhere are unchanged. | The officer-transition route returns HTTP 409 with the fixed wording. |
| `step_down_as_admin` | Stepping down while retaining President fails with `CCG01`; an ordinary non-President succession is unchanged. | The officer-transition route returns HTTP 409 with the fixed wording. |
| Manual fixture/bootstrap insert or update | The complete proposed row is checked directly. Invalid assignments receive fixed `CCG01`; there is no session-user or service-role bypass. | SQL receives only the fixed database text, with no email or internal detail. |
| `users_guard_officer_writes` | Its trigger name sorts before the new trigger. Unauthorized protected writes retain `CCO08` precedence. | Existing routes keep the plain `This officer account could not be changed through that action.` mapping. |

Lifecycle, name, avatar, anonymization, activity-log, and Auth paths do not
change role/committee and remain operational under the grandfather rule. No
other current writer changes `public.users.role` or
`public.users.committee_id`.

## Dev SQL verification — 30 result lines

Dev only. In the Dev SQL Editor, select **Run without RLS** and paste the whole
block. It creates all Auth/profile/committee/invite fixtures inside one
transaction, includes authenticated impersonation, prints 30 result rows, and
ends in the intentional `TEST RESULTS 30/30 PASS` exception so everything is
rolled back. It uses a plain in-transaction results table and no temporary
table.

```sql
begin;

create table public.v1b_president_guard_test_results (
  label text primary key,
  passed boolean not null
);
grant insert, select on public.v1b_president_guard_test_results to authenticated;

create function pg_temp.ok(p_label text, p_passed boolean)
returns void language plpgsql as $$
begin
  insert into public.v1b_president_guard_test_results(label, passed)
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
declare
  president_id uuid;
begin
  select committee_row.id into president_id
  from public.committees as committee_row
  where committee_row.name = 'President';

  if president_id is null then
    raise exception 'The canonical President committee is missing.';
  end if;

  perform pg_catalog.set_config('v1b.president', president_id::text, true);

  update public.app_settings
  set enforce_officer_role_caps = false
  where key = 'global';

  insert into public.committees(id, name) values
    ('b100c000-0000-4000-8000-000000000001', 'V1b Normal A'),
    ('b100c000-0000-4000-8000-000000000002', 'V1b Normal B'),
    ('b100c000-0000-4000-8000-000000000003', 'V1b Normal C');

  insert into auth.users(
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, invited_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  )
  select fixture.id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', fixture.email, '',
    case when fixture.id in (
      'b1000000-0000-4000-8000-000000000004'::uuid,
      'b1000000-0000-4000-8000-000000000012'::uuid
    ) then null else now() end,
    case when fixture.id in (
      'b1000000-0000-4000-8000-000000000004'::uuid,
      'b1000000-0000-4000-8000-000000000012'::uuid
    ) then now() else null end,
    '{}', '{}',
    now(), now()
  from (values
    ('b1000000-0000-4000-8000-000000000001'::uuid, 'v1b-admin@example.test'),
    ('b1000000-0000-4000-8000-000000000002'::uuid, 'v1b-standby-admin@example.test'),
    ('b1000000-0000-4000-8000-000000000003'::uuid, 'v1b-legacy@example.test'),
    ('b1000000-0000-4000-8000-000000000004'::uuid, 'v1b-member-invite@example.test'),
    ('b1000000-0000-4000-8000-000000000005'::uuid, 'v1b-officer-finalize@example.test'),
    ('b1000000-0000-4000-8000-000000000006'::uuid, 'v1b-appoint@example.test'),
    ('b1000000-0000-4000-8000-000000000007'::uuid, 'v1b-return@example.test'),
    ('b1000000-0000-4000-8000-000000000008'::uuid, 'v1b-move@example.test'),
    ('b1000000-0000-4000-8000-000000000009'::uuid, 'v1b-president-admin@example.test'),
    ('b1000000-0000-4000-8000-000000000010'::uuid, 'v1b-normal@example.test'),
    ('b1000000-0000-4000-8000-000000000011'::uuid, 'v1b-return-normal@example.test'),
    ('b1000000-0000-4000-8000-000000000012'::uuid, 'v1b-member-normal@example.test')
  ) as fixture(id, email);

  perform pg_catalog.set_config(
    'ceit_connect.officer_writer', 'invite_new_officer', true
  );
  insert into public.users(
    id, email, full_name, role, committee_id, is_active
  ) values
    ('b1000000-0000-4000-8000-000000000001', 'v1b-admin@example.test',
      'V1b Admin', 'Admin', null, true),
    ('b1000000-0000-4000-8000-000000000002', 'v1b-standby-admin@example.test',
      'V1b Standby Admin', 'Admin', null, true),
    ('b1000000-0000-4000-8000-000000000007', 'v1b-return@example.test',
      'V1b Return Co-Admin', 'Co-Admin',
      'b100c000-0000-4000-8000-000000000001', true),
    ('b1000000-0000-4000-8000-000000000009', 'v1b-president-admin@example.test',
      'V1b President Admin', 'Admin', president_id, false),
    ('b1000000-0000-4000-8000-000000000011', 'v1b-return-normal@example.test',
      'V1b Normal Return Co-Admin', 'Co-Admin',
      'b100c000-0000-4000-8000-000000000002', true);
  perform pg_catalog.set_config('ceit_connect.officer_writer', '', true);

  insert into public.users(
    id, email, full_name, role, committee_id, is_active
  ) values
    ('b1000000-0000-4000-8000-000000000006', 'v1b-appoint@example.test',
      'V1b Appoint Member', 'Member',
      'b100c000-0000-4000-8000-000000000002', true),
    ('b1000000-0000-4000-8000-000000000008', 'v1b-move@example.test',
      'V1b Move Member', 'Member',
      'b100c000-0000-4000-8000-000000000001', true),
    ('b1000000-0000-4000-8000-000000000010', 'v1b-normal@example.test',
      'V1b Normal Member', 'Member',
      'b100c000-0000-4000-8000-000000000001', true);

  alter table public.users disable trigger users_guard_president_committee;
  insert into public.users(
    id, email, full_name, role, committee_id, is_active, avatar_url
  ) values (
    'b1000000-0000-4000-8000-000000000003',
    'v1b-legacy@example.test', 'V1b Legacy Member', 'Member',
    president_id, true, 'b1000000-0000-4000-8000-000000000003/avatar.webp'
  );
  alter table public.users enable trigger users_guard_president_committee;

  insert into public.officer_invites(
    id, email, full_name, officer_role, committee_id,
    invited_by, status, created_at
  ) values (
    'b1001000-0000-4000-8000-000000000001',
    'v1b-officer-finalize@example.test', 'V1b Legacy Invite',
    'Co-Admin', president_id,
    'b1000000-0000-4000-8000-000000000001', 'preparing', now()
  );
end;
$fixtures$;

do $catalog$
declare
  guard_proc pg_catalog.pg_proc%rowtype;
  invite_proc pg_catalog.pg_proc%rowtype;
  trigger_names text[];
begin
  select procedure_row.* into guard_proc
  from pg_catalog.pg_proc as procedure_row
  where procedure_row.oid =
    'public.guard_president_committee_admin()'::pg_catalog.regprocedure;

  select procedure_row.* into invite_proc
  from pg_catalog.pg_proc as procedure_row
  where procedure_row.oid =
    'public.invite_new_officer(uuid,uuid,text,text,text,uuid)'::pg_catalog.regprocedure;

  select pg_catalog.array_agg(trigger_row.tgname::text order by trigger_row.tgname)
  into trigger_names
  from pg_catalog.pg_trigger as trigger_row
  where trigger_row.tgrelid = 'public.users'::pg_catalog.regclass
    and trigger_row.tgname in (
      'users_guard_officer_writes',
      'users_guard_president_committee'
    )
    and not trigger_row.tgisinternal;

  perform pg_temp.ok('01 canonical President lookup is unique',
    (select pg_catalog.count(*) = 1 from public.committees where name = 'President'));
  perform pg_temp.ok('02 guard metadata is pinned',
    pg_catalog.pg_get_userbyid(guard_proc.proowner) = 'postgres'
    and guard_proc.prosecdef
    and guard_proc.provolatile = 'v'
    and guard_proc.proconfig = array['search_path=""']::text[]);
  perform pg_temp.ok('03 guard has no browser or service execute grant',
    not pg_catalog.has_function_privilege('public', guard_proc.oid, 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', guard_proc.oid, 'EXECUTE')
    and not pg_catalog.has_function_privilege('authenticated', guard_proc.oid, 'EXECUTE')
    and not pg_catalog.has_function_privilege('service_role', guard_proc.oid, 'EXECUTE'));
  perform pg_temp.ok('04 President trigger is BEFORE INSERT UPDATE only',
    (select (trigger_row.tgtype::integer & 2) = 2
      and (trigger_row.tgtype::integer & 4) = 4
      and (trigger_row.tgtype::integer & 16) = 16
      and (trigger_row.tgtype::integer & 8) = 0
     from pg_catalog.pg_trigger as trigger_row
     where trigger_row.tgrelid = 'public.users'::pg_catalog.regclass
       and trigger_row.tgname = 'users_guard_president_committee'
       and not trigger_row.tgisinternal));
  perform pg_temp.ok('05 officer guard fires before President guard',
    trigger_names = array[
      'users_guard_officer_writes',
      'users_guard_president_committee'
    ]::text[]);
  perform pg_temp.ok('06 invite writer owner path and grants stay exact',
    pg_catalog.pg_get_userbyid(invite_proc.proowner) = 'postgres'
    and invite_proc.prosecdef
    and invite_proc.provolatile = 'v'
    and invite_proc.proconfig = array['search_path=""']::text[]
    and not pg_catalog.has_function_privilege('public', invite_proc.oid, 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', invite_proc.oid, 'EXECUTE')
    and pg_catalog.has_function_privilege('authenticated', invite_proc.oid, 'EXECUTE')
    and not pg_catalog.has_function_privilege('service_role', invite_proc.oid, 'EXECUTE'));
  perform pg_temp.ok('07 invite authorizes before lock and reauthorizes',
    pg_catalog.strpos(
      invite_proc.prosrc,
      'v_caller_id := public.officer_require_active_admin();'
    ) < pg_catalog.strpos(
      invite_proc.prosrc,
      'perform pg_catalog.pg_advisory_xact_lock'
    )
    and (
      pg_catalog.length(invite_proc.prosrc)
      - pg_catalog.length(pg_catalog.replace(
          invite_proc.prosrc,
          'v_caller_id := public.officer_require_active_admin();',
          ''
        ))
    ) / pg_catalog.length(
      'v_caller_id := public.officer_require_active_admin();'
    ) = 2);
  perform pg_temp.ok('08 fixed code and text exist in both layers',
    guard_proc.prosrc like '%CCG01%'
    and guard_proc.prosrc like '%Only Admins can be assigned to the President committee.%'
    and invite_proc.prosrc like '%CCG01%'
    and invite_proc.prosrc like '%Only Admins can be assigned to the President committee.%');
end;
$catalog$;

do $owner_raw$
declare
  denied boolean;
  president_id uuid := pg_catalog.current_setting('v1b.president')::uuid;
begin
  denied := false;
  begin
    update public.users
    set role = 'Co-Admin'
    where id = 'b1000000-0000-4000-8000-000000000003';
  exception when others then
    denied := sqlstate = 'CCO08';
  end;
  perform pg_temp.ok('09 unauthorized protected write keeps CCO08 precedence', denied);

  denied := false;
  begin
    insert into public.users(
      id, email, full_name, role, committee_id, is_active
    ) values (
      gen_random_uuid(), 'v1b-invalid-insert@example.test',
      'Invalid President Member', 'Member', president_id, true
    );
  exception when others then
    denied := sqlstate = 'CCG01'
      and sqlerrm = 'Only Admins can be assigned to the President committee.';
  end;
  perform pg_temp.ok('10 raw invalid INSERT gets fixed CCG01', denied);

  perform pg_temp.ok('11 valid Admin President fixture is accepted',
    exists(select 1 from public.users
      where id = 'b1000000-0000-4000-8000-000000000009'
        and role = 'Admin' and committee_id = president_id));
end;
$owner_raw$;

select pg_temp.auth_as('b1000000-0000-4000-8000-000000000001');
set local role authenticated;

do $admin_writers$
declare
  denied boolean;
  president_id uuid := pg_catalog.current_setting('v1b.president')::uuid;
  outcome jsonb;
begin
  denied := false;
  begin
    perform public.finalize_member_invite(
      'b1000000-0000-4000-8000-000000000004',
      'v1b-member-invite@example.test', 'V1b Invalid Member', president_id
    );
  exception when others then
    denied := sqlstate = 'CCG01';
  end;
  perform pg_temp.ok('12 Member finalizer rejects President', denied);

  perform public.finalize_member_invite(
    'b1000000-0000-4000-8000-000000000012',
    'v1b-member-normal@example.test', 'V1b Normal Finalized Member',
    'b100c000-0000-4000-8000-000000000003'
  );
  perform pg_temp.ok('13 Member finalizer keeps normal committee working',
    exists(select 1 from public.users
      where id = 'b1000000-0000-4000-8000-000000000012'
        and role = 'Member'
        and committee_id = 'b100c000-0000-4000-8000-000000000003'));

  denied := false;
  begin
    perform public.invite_new_officer(
      'b1001000-0000-4000-8000-000000000002', null,
      'v1b-invalid-officer@example.test', 'V1b Invalid Officer',
      'Co-Admin', president_id
    );
  exception when others then
    denied := sqlstate = 'CCG01';
  end;
  perform pg_temp.ok('14 officer preparation rejects President', denied);

  outcome := public.invite_new_officer(
    'b1001000-0000-4000-8000-000000000003', null,
    'v1b-valid-officer@example.test', 'V1b Valid Officer',
    'Co-Admin', 'b100c000-0000-4000-8000-000000000003'
  );
  perform pg_temp.ok('15 officer preparation keeps normal committee working',
    outcome->>'outcome' = 'prepared');

  denied := false;
  begin
    perform public.invite_new_officer(
      'b1001000-0000-4000-8000-000000000001',
      'b1000000-0000-4000-8000-000000000005',
      null, null, null, null
    );
  exception when others then
    denied := sqlstate = 'CCG01';
  end;
  perform pg_temp.ok('16 legacy officer finalization is stopped by users guard', denied);

  denied := false;
  begin
    perform public.appoint_member_as_officer(
      'b1000000-0000-4000-8000-000000000006', 'Co-Admin', president_id
    );
  exception when others then
    denied := sqlstate = 'CCG01';
  end;
  perform pg_temp.ok('17 appoint rejects Co-Admin President result', denied);

  perform public.appoint_member_as_officer(
    'b1000000-0000-4000-8000-000000000006', 'Admin', null
  );
  perform pg_temp.ok('18 appoint Admin still clears committee and succeeds',
    exists(select 1 from public.users
      where id = 'b1000000-0000-4000-8000-000000000006'
        and role = 'Admin' and committee_id is null));

  denied := false;
  begin
    perform public.return_coadmin_to_member(
      'b1000000-0000-4000-8000-000000000007', president_id
    );
  exception when others then
    denied := sqlstate = 'CCG01';
  end;
  perform pg_temp.ok('19 return-to-member rejects President target', denied);

  perform public.return_coadmin_to_member(
    'b1000000-0000-4000-8000-000000000011',
    'b100c000-0000-4000-8000-000000000003'
  );
  perform pg_temp.ok('20 return-to-member keeps normal target working',
    exists(select 1 from public.users
      where id = 'b1000000-0000-4000-8000-000000000011'
        and role = 'Member'
        and committee_id = 'b100c000-0000-4000-8000-000000000003'));

  denied := false;
  begin
    perform public.move_member_to_committee(
      'b1000000-0000-4000-8000-000000000008', president_id
    );
  exception when others then
    denied := sqlstate = 'CCG01';
  end;
  perform pg_temp.ok('21 move Member rejects President target', denied);

  perform public.move_member_to_committee(
    'b1000000-0000-4000-8000-000000000008',
    'b100c000-0000-4000-8000-000000000002'
  );
  perform pg_temp.ok('22 move Member keeps normal target working',
    exists(select 1 from public.users
      where id = 'b1000000-0000-4000-8000-000000000008'
        and committee_id = 'b100c000-0000-4000-8000-000000000002'));

  denied := false;
  begin
    perform public.step_down_as_admin(president_id);
  exception when others then
    denied := sqlstate = 'CCG01';
  end;
  perform pg_temp.ok('23 Admin step-down rejects President target', denied);
end;
$admin_writers$;

reset role;
select pg_temp.auth_as('b1000000-0000-4000-8000-000000000003');
set local role authenticated;

do $legacy_name$
declare
  saved_name text;
begin
  saved_name := public.update_own_profile('V1b Legacy Renamed');
  perform pg_temp.ok('24 grandfathered President Member can be renamed',
    saved_name = 'V1b Legacy Renamed');
end;
$legacy_name$;

reset role;

do $legacy_lifecycle$
declare
  denied boolean;
  president_id uuid := pg_catalog.current_setting('v1b.president')::uuid;
begin
  update public.users
  set is_active = false, avatar_url = null
  where id = 'b1000000-0000-4000-8000-000000000003';
  perform pg_temp.ok('25 grandfathered President Member can be deactivated',
    exists(select 1 from public.users
      where id = 'b1000000-0000-4000-8000-000000000003'
        and not is_active and role = 'Member' and committee_id = president_id));

  update public.users
  set is_active = true
  where id = 'b1000000-0000-4000-8000-000000000003';
  perform pg_temp.ok('26 grandfathered President Member can be reactivated',
    exists(select 1 from public.users
      where id = 'b1000000-0000-4000-8000-000000000003'
        and is_active and role = 'Member' and committee_id = president_id));

  denied := false;
  perform pg_catalog.set_config(
    'ceit_connect.officer_writer', 'appoint_member_as_officer', true
  );
  begin
    update public.users
    set role = 'Co-Admin'
    where id = 'b1000000-0000-4000-8000-000000000003';
  exception when others then
    denied := sqlstate = 'CCG01';
  end;
  perform pg_catalog.set_config('ceit_connect.officer_writer', '', true);
  perform pg_temp.ok('27 role change that keeps President fails CCG01', denied);

  update public.users
  set is_active = false
  where id = 'b1000000-0000-4000-8000-000000000003';
end;
$legacy_lifecycle$;

select pg_temp.auth_as('b1000000-0000-4000-8000-000000000001');
set local role authenticated;

do $anonymize$
declare
  anon record;
begin
  select * into anon
  from public.anonymize_former_member(
    'b1000000-0000-4000-8000-000000000003'
  );
  perform pg_temp.ok('28 grandfathered President Member can be anonymized',
    anon.out_outcome = 'anonymized'
    and exists(select 1 from public.users
      where id = 'b1000000-0000-4000-8000-000000000003'
        and role = 'Member'
        and committee_id = pg_catalog.current_setting('v1b.president')::uuid
        and not is_active
        and anonymized_at is not null));
end;
$anonymize$;

reset role;

do $normal_update$
begin

  update public.users
  set full_name = 'V1b Normal Updated',
      avatar_url = 'b1000000-0000-4000-8000-000000000010/avatar.webp'
  where id = 'b1000000-0000-4000-8000-000000000010';
  perform pg_temp.ok('29 non-President name and avatar update is unaffected',
    exists(select 1 from public.users
      where id = 'b1000000-0000-4000-8000-000000000010'
        and full_name = 'V1b Normal Updated'
        and avatar_url = 'b1000000-0000-4000-8000-000000000010/avatar.webp'));
end;
$normal_update$;

select pg_temp.auth_as('b1000000-0000-4000-8000-000000000001');
set local role authenticated;

do $stepdown$
begin

  perform public.step_down_as_admin(
    'b100c000-0000-4000-8000-000000000001'
  );
  perform pg_temp.ok('30 Admin step-down keeps normal target working',
    exists(select 1 from public.users
      where id = 'b1000000-0000-4000-8000-000000000001'
        and role = 'Member'
        and committee_id = 'b100c000-0000-4000-8000-000000000001'));
end;
$stepdown$;

reset role;

select label, passed
from public.v1b_president_guard_test_results
order by label;

do $finish$
declare
  passed_count integer;
  total_count integer;
begin
  select pg_catalog.count(*)::integer,
         pg_catalog.count(*) filter (where result.passed)::integer
  into total_count, passed_count
  from public.v1b_president_guard_test_results as result;

  if total_count = 30 and passed_count = 30 then
    raise exception 'TEST RESULTS 30/30 PASS (intentional rollback)';
  end if;

  raise exception 'TEST RESULTS %/30 PASS (intentional rollback)', passed_count;
end;
$finish$;

rollback;
```

## Automated verification

The migration contract compares the replacement `invite_new_officer` body with
the latest source and permits only the two approved edits. It also pins LF,
dollar quoting, the exact trigger/grant/owner/search-path contract, and the
absence of service-role or `session_user` exceptions. Route tests cover Member
invite cleanup, preparation refusal before Auth, transition wording, and the
legacy-finalization cancellation/Auth-cleanup path.
