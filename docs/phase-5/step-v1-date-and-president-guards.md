# V1 — Active-task date floor and foreign-template schedule reset

Status: implemented locally for parts (a) and (c), pending owner review. Part
(b), the President-committee invariant, is deliberately not written until the
owner reports the read-only Prod preflight result.

## Scope and migration order

- `20261121120000_active_task_date_guard.sql` — Active-board Add/Edit date floor.
- `20261121130000_template_import_foreign_date_reset.sql` — Co-Admin foreign
  archived-template schedule reset.
- `20261121140000` — reserved for the later President guard; no file exists.

Neither implemented migration adds an FK to `events` or `tasks`, so the CCE09
event-deletion lock inventory is unchanged. Searches of `supabase/migrations`
and `src` found no prior use of CCD07, CCD08, or CCD09; V1 assigns them as
listed below.

## Date rule and fixed messages

All comparisons use calendar dates in `Asia/Manila` internally. UI text does
not name a timezone.

| Code | Database text and user wording | HTTP |
| --- | --- | --- |
| CCD07 | `Choose today or a later due date.` | 400 |
| CCD08 | `Choose today or a later duty date.` | 400 |
| CCD09 | `Choose today or a later end date.` | 400 |

Create rejects every non-null proposed due/call/end calendar date before
today. Edit compares the proposed and stored calendar dates inside the locked
database row: an unchanged old date remains valid, including a time-only edit;
a different old date is rejected; clearing is allowed. Today remains valid
after the selected time has passed, and an overnight end on the following date
remains valid. `tasks.due_date`, `call_time`, and `end_time` are all
`timestamptz`; a due date stored at 00:00 UTC is 08:00 on the same intended
calendar date.

The public RPC signatures do not change. The new checks run only after the
existing authorization and locks. Edit additionally runs them after the
authoritative row `FOR UPDATE`, the repeated authorization, and the CCS01
stale-token check. Therefore authorization wins first, then assignment/row
reconciliation and stale-token errors, then CCD07/08/09, then the existing
event-end trigger errors CCD05/CCD02/CCD03. When a fresh authorized proposal is
both before today and beyond an already-ended event, the new today-or-later
error wins. The SQL paste tests both precedence cases.

The app performs the same create check before opening its data client and the
dialog performs the same check before its existing event-end check. PATCH does
not accept a client snapshot: the database alone compares against the stored
locked row. Old tabs retain the same request/RPC shapes; after the migration,
a rejected date returns one of the fixed codes and the already-deployed app
maps it to the same plain message.

## Active schedule-writer inventory

| Writer | Active-event schedule effect | V1 treatment |
| --- | --- | --- |
| `POST /api/active-task` → `create_active_event_task` → internal `create_active_event_task_step12` | Writes due/call/end for board Add Task | UI, API, and database floor |
| `PATCH /api/active-task` → `edit_active_event_task` → internal `edit_active_event_task_step12` | Writes due/call/end for board Edit Task | UI mapping plus database changed-only floor; no client snapshot |
| `create_event_with_tasks` | May create an Active event and its tasks | Deliberately exempt; past dates remain valid |
| `edit_event_with_tasks` | May rewrite task schedules while editing Draft/Active events | Deliberately outside this board-only guard; existing event-end checks remain |
| `create_event_from_archived_template` and `copy_archived_template_tasks` | Imports archived tasks | Deliberately exempt from the floor; part (c) blanks foreign schedules |
| Direct authenticated `tasks UPDATE` allowed by the current Admin/own-Co-Admin task policy and guards | Can write schedule columns without the board RPC | Not fixed in V1; recorded in `docs/PROGRESS.md` deferred list |

No other task RPC found in the repository writes `due_date`, `call_time`, or
`end_time`. Status, move, dependency, assignment, confidentiality, backup,
volunteer, leave, comment, and work-link writers do not write these columns.

## Latest-definition proof

The latest bodies that became the internal Step 12 functions are the
`create_active_event_task` and `edit_active_event_task` definitions in
`20261028130000_active_event_task_writers.sql`; migration
`20261029150000_task_rules.sql` renamed them and added the only public wrapper
calls. Repository-wide call searches confirm nothing else calls either
internal function. Other appearances are only the rename/revoke and this
migration's definition/owner/revoke statements.

| Function | Old definition | New definition | Behavior difference |
| --- | --- | --- | --- |
| Create internal | Latest renamed original: 13 arguments, table `(out_task_id uuid, out_updated_at timestamptz)`, volatile postgres-owned fixed-empty-path definer, no client execute | Same signature, return shape, body, owner, volatility, path, and no client execute | The exact create floor block below is inserted after locked-event/repeated authorization and committee authorization |
| Edit internal | Latest renamed original: 14 arguments, table `(out_task_id uuid, out_updated_at timestamptz, out_status text, out_sort_order bigint)`, same security properties | Same signature, return shape, body, owner, volatility, path, and no client execute | The exact changed-only block below is inserted after the locked stored row, repeated authorization, committee authorization, and CCS01 check |
| `copy_archived_template_tasks` | Latest `20261031120000` four-argument copier with `p_new_start_date date`, integer copied-count return, and shifted foreign due/call/end expressions | Same signature, validation, source filters, copied count, return value, owner, volatility, path, and no client execute | Removes only dead `v_shift_days` state and replaces the three shifted expressions with `null::timestamptz` |

The automated migration contract extracts the dollar-quoted bodies. For each
Step 12 function it removes the exact block below and requires byte-for-byte
equality with the latest renamed original body. For the copier it applies only
the five declared transformations—remove the shift variable and assignment,
then replace the due/call/end CASE expressions—and requires exact equality.

Added to Create, and nothing else:

```sql
  if p_due_date is not null
     and (p_due_date at time zone 'Asia/Manila')::date
       < (statement_timestamp() at time zone 'Asia/Manila')::date then
    raise exception using errcode = 'CCD07',
      message = 'Choose today or a later due date.';
  end if;

  if p_call_time is not null
     and (p_call_time at time zone 'Asia/Manila')::date
       < (statement_timestamp() at time zone 'Asia/Manila')::date then
    raise exception using errcode = 'CCD08',
      message = 'Choose today or a later duty date.';
  end if;

  if p_end_time is not null
     and (p_end_time at time zone 'Asia/Manila')::date
       < (statement_timestamp() at time zone 'Asia/Manila')::date then
    raise exception using errcode = 'CCD09',
      message = 'Choose today or a later end date.';
  end if;
```

Added to Edit, and nothing else:

```sql
  if p_due_date is not null
     and (p_due_date at time zone 'Asia/Manila')::date
       < (statement_timestamp() at time zone 'Asia/Manila')::date
     and (p_due_date at time zone 'Asia/Manila')::date
       is distinct from (v_stored_due_date at time zone 'Asia/Manila')::date then
    raise exception using errcode = 'CCD07',
      message = 'Choose today or a later due date.';
  end if;

  if p_call_time is not null
     and (p_call_time at time zone 'Asia/Manila')::date
       < (statement_timestamp() at time zone 'Asia/Manila')::date
     and (p_call_time at time zone 'Asia/Manila')::date
       is distinct from (v_stored_call_time at time zone 'Asia/Manila')::date then
    raise exception using errcode = 'CCD08',
      message = 'Choose today or a later duty date.';
  end if;

  if p_end_time is not null
     and (p_end_time at time zone 'Asia/Manila')::date
       < (statement_timestamp() at time zone 'Asia/Manila')::date
     and (p_end_time at time zone 'Asia/Manila')::date
       is distinct from (v_stored_end_time at time zone 'Asia/Manila')::date then
    raise exception using errcode = 'CCD09',
      message = 'Choose today or a later end date.';
  end if;
```

## Template-copy behavior

The copier keeps `p_new_start_date` in its signature and destination
validation. For a Co-Admin, every retained foreign-committee task now receives
null due/call/end values. A foreign Live Operation with no schedule remains a
valid copied task. The copied row count and integer return value are unchanged.
Admin imports continue through the ordinary event-task writer and retain their
current behavior; Co-Admin-owned tasks remain the U1 client payload. Archived
imports and event creation remain outside the Active-board date guard.

## Automated test changes

- New `src/lib/timezone.test.ts`: calendar midnight boundary and 00:00 UTC due
  storage.
- Changed `src/lib/tasks/active-task.test.ts`: create floors, today/overnight,
  changed-only edits, time-only edits, clearing, and CCD07–09 mapping.
- Changed `src/lib/tasks/active-task-ui.test.ts`: input minima and grandfathered
  values, including the stricter duty-to-end relationship.
- Changed `src/app/api/active-task/route.test.ts`: POST rejection before a data
  client and PATCH mapping without leaking database text.
- Changed `src/lib/tasks/phase-completion.test.ts`: CCD07–09 join the inventory
  of existing codes that phase-completion mapping must not intercept.
- Changed `src/lib/notifications/notification-foundation-migration-contract.test.ts`:
  the exact latest-migration ordering now includes both new V1 migrations.
- Changed `src/components/tasks/active-task-ui-contract.test.ts`: its source
  contract now counts the additional date-floor invalid-field focus branch.
- New `src/lib/tasks/v1-date-template-migration-contract.test.ts`: exact Step 12
  body equivalence, check placement, internal call inventory, due column type,
  copier-only transformation, signature/count/return preservation, and grants.

No pre-existing automated template-import contract test pinned the shifted
copier expressions. The new migration-contract test is the first such pin and
proves the reset is the only copier-body behavior change.

## Part (b) placeholder — blocked on Prod preflight

No President guard migration, trigger, function, or app mapping is included.
Migration timestamp `20261121140000` remains reserved. The repository writer
inventory to carry into that later implementation is:

| Path | `users` effect | Later invariant impact |
| --- | --- | --- |
| `/api/invite` → `finalize_member_invite` | Inserts a Member with the submitted committee | Complete INSERT row must be valid |
| `/api/invite-officers` → `invite_new_officer` | Inserts an Admin with null committee or a Co-Admin with its committee | Complete INSERT row must be valid |
| `/api/officer-transitions` → `appoint_member_as_officer` | Updates both role and committee | Admin appointment clears committee; Co-Admin appointment must not retain/select President |
| Same route → `return_coadmin_to_member` | Updates role to Member and committee together | Valid ordinary committee succeeds; President target must not |
| Same route → `move_member_to_committee` | Updates Member `committee_id` | President target must not succeed |
| Same route → `step_down_as_admin` | Updates the caller to Member plus the chosen committee | The combined new row is checked; demoting an Admin who still holds President must fail before an invalid row exists |
| First-Admin bootstrap and any owner-run direct SQL/fixture insert | Can insert an arbitrary profile | Complete INSERT row is checked; there is no bypass path |
| Existing `users_guard_officer_writes` and the invitation/transition marker paths | Guard who may perform officer inserts/updates | Remain authorization layers; they do not replace the later row invariant |
| `/api/toggle-user-active` → `set_officer_active`, `deactivate_committee_member`, or `reactivate_committee_member` | Changes active/avatar state only | Existing valid role/committee pair remains unchanged and succeeds |
| `/api/remove-former-members` → `anonymize_former_member` | Latest body anonymizes/deactivates identity fields while preserving role and committee | Existing valid pair remains unchanged; no user is deleted |
| `update_own_profile`, `/api/update-member-name` → `update_committee_member_full_name`, and `/api/update-avatar` service-role updates | Change name or avatar only | Existing valid pair remains unchanged and succeeds |
| Activity-log `AFTER INSERT OR UPDATE` observer | Records changes but does not write role/committee | No additional writer path |
| Auth callback/sign-in and Auth `auth.users` creation | Do not insert `public.users`; the app is invite-only and has no public-sign-up profile trigger | No hidden profile writer; invitation finalizers above own profile creation |

After the owner reports the SELECT-only Prod result, the inventory will be
rechecked against the then-latest migration bodies before any guard is written.
The later invariant must inspect the complete NEW row on INSERT and UPDATE. A
demotion that still leaves President assigned must fail with one fixed safe
message; officer-transition and former-member flows must keep valid role and
committee changes atomic so the invariant never observes an invalid final row.
No user will be hard-deleted.

## Rollout

Dev: push migrations, run the SQL test, test the app.

Prod: merge, app deploy ready, THEN migrations.

The app ships first because it understands CCD07–09 before the database can
emit them. Old tabs keep the unchanged API payload and RPC signatures and
receive the same safe response mapping from the newly deployed route.

## Local verification

- `npx.cmd tsc --noEmit` passed.
- `npm.cmd run test`: all V1 coverage passed; the full result is 1,439/1,442,
  with only the three pre-existing CRLF-sensitive J1 source-contract failures.
- `npm.cmd run lint` exited zero with only the pre-existing unused `INK` warning
  in `src/components/ui/mascot.tsx`.
- No build, Supabase command, Dev push, or Dev SQL run was performed.

## Single Dev SQL verification paste

Run on **Dev only**, with **Run without RLS**, after both migrations are pushed.
It creates its own `auth.users` fixtures, contains explicit authenticated-role
impersonation, uses a plain in-transaction results table, and rolls everything
back through the final exception. Expected result-line count: **32**.

```sql
begin;

select pg_catalog.set_config('timezone', 'Asia/Manila', true);

create table public.v1_guard_test_results (
  label text primary key,
  passed boolean not null
);
grant insert, select on public.v1_guard_test_results to authenticated;

create function pg_temp.ok(p_label text, p_passed boolean)
returns void language plpgsql as $$
begin
  insert into public.v1_guard_test_results(label, passed)
  values (p_label, coalesce(p_passed, false));
end;
$$;

create function pg_temp.auth_as(p_user uuid)
returns void language plpgsql as $$
begin
  perform pg_catalog.set_config(
    'request.jwt.claims',
    case when p_user is null then '{"role":"authenticated"}'
      else pg_catalog.jsonb_build_object(
        'sub', p_user::text, 'role', 'authenticated'
      )::text
    end,
    true
  );
  perform pg_catalog.set_config(
    'request.jwt.claim.sub', coalesce(p_user::text, ''), true
  );
  perform pg_catalog.set_config(
    'request.jwt.claim.role', 'authenticated', true
  );
end;
$$;

create function pg_temp.local_ts(p_date date, p_hour integer, p_minute integer)
returns timestamptz language sql immutable as $$
  select pg_catalog.make_timestamptz(
    extract(year from p_date)::integer,
    extract(month from p_date)::integer,
    extract(day from p_date)::integer,
    p_hour,
    p_minute,
    0,
    'Asia/Manila'
  )
$$;

do $fixtures$
declare
  t text := 'v1-' || gen_random_uuid();
  admin_id uuid := gen_random_uuid();
  coa_id uuid := gen_random_uuid();
  member_id uuid := gen_random_uuid();
  own_committee uuid := gen_random_uuid();
  foreign_committee uuid := gen_random_uuid();
  active_id uuid := gen_random_uuid();
  ended_id uuid := gen_random_uuid();
  source_id uuid := gen_random_uuid();
  destination_id uuid := gen_random_uuid();
  excluded_destination_id uuid := gen_random_uuid();
  old_task_id uuid := gen_random_uuid();
  ended_task_id uuid := gen_random_uuid();
  source_task_id uuid := gen_random_uuid();
  secret_task_id uuid := gen_random_uuid();
  today date := (statement_timestamp() at time zone 'Asia/Manila')::date;
begin
  insert into auth.users(
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  )
  select fixture.id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    t || '-' || fixture.label || '@example.test',
    crypt('V1-test-only!', gen_salt('bf')), now(), '{}',
    pg_catalog.jsonb_build_object('v1_test', t), now(), now()
  from (values
    (admin_id, 'admin'),
    (coa_id, 'coadmin'),
    (member_id, 'member')
  ) fixture(id, label);

  insert into public.committees(id, name) values
    (own_committee, t || ' Own'),
    (foreign_committee, t || ' Foreign');

  perform pg_catalog.set_config(
    'ceit_connect.officer_writer', 'invite_new_officer', true
  );
  insert into public.users(
    id, email, full_name, role, committee_id, is_active
  ) values
    (admin_id, t || '-admin@example.test', 'V1 Admin', 'Admin', null, true),
    (coa_id, t || '-coadmin@example.test', 'V1 Co-Admin',
      'Co-Admin', own_committee, true);
  perform pg_catalog.set_config('ceit_connect.officer_writer', '', true);
  insert into public.users(
    id, email, full_name, role, committee_id, is_active
  ) values
    (member_id, t || '-member@example.test', 'V1 Member',
      'Member', foreign_committee, true);

  insert into public.events(
    id, name, start_date, end_date, status, created_by
  ) values
    (active_id, t || ' Active', today - 10, today + 30, 'Active', admin_id),
    (ended_id, t || ' Ended Active', today - 10, today - 2,
      'Active', admin_id),
    (source_id, t || ' Source', today - 20, today - 5,
      'Active', admin_id),
    (destination_id, t || ' Destination', today + 20, today + 30,
      'Active', coa_id),
    (excluded_destination_id, t || ' Excluded Destination',
      today + 20, today + 30, 'Active', coa_id);

  perform pg_catalog.set_config(
    'ceit_connect.task_assignee_writer', 'create_event_with_tasks', true
  );
  perform pg_catalog.set_config(
    'ceit_connect.task_access_writer', 'create_active_event_task', true
  );
  insert into public.tasks(
    id, event_id, committee_id, title, phase, status, priority,
    task_type, due_date, call_time, end_time, primary_assignees,
    assist_assignees, is_confidential, allowed_viewers, created_by,
    sort_order
  ) values
    (old_task_id, active_id, foreign_committee, 'Old schedule', 'Setup',
      'To Do', 'Medium', 'LiveOperation',
      ((today - 4)::text || ' 00:00:00+00')::timestamptz,
      pg_temp.local_ts(today - 4, 2, 0),
      pg_temp.local_ts(today - 4, 4, 0),
      '{}', '{}', false, '{}', admin_id, 1024),
    (ended_task_id, ended_id, foreign_committee, 'Ended event task',
      'Setup', 'To Do', 'Medium', 'Deliverable',
      ((today - 3)::text || ' 00:00:00+00')::timestamptz,
      null, null, '{}', '{}', false, '{}', admin_id, 1024),
    (source_task_id, source_id, foreign_committee, 'Foreign live source',
      'Live', 'To Do', 'High', 'LiveOperation',
      ((today - 8)::text || ' 00:00:00+00')::timestamptz,
      pg_temp.local_ts(today - 8, 23, 0),
      pg_temp.local_ts(today - 7, 2, 0),
      '{}', '{}', false, '{}', admin_id, 1024),
    (secret_task_id, source_id, foreign_committee, 'V1 SECRET',
      'Secret', 'To Do', 'High', 'Deliverable', null, null, null,
      '{}', '{}', true, '{}', admin_id, 2048);
  perform pg_catalog.set_config('ceit_connect.task_access_writer', '', true);
  perform pg_catalog.set_config('ceit_connect.task_assignee_writer', '', true);

  update public.events event_row
  set status = 'Archived'
  where event_row.id = source_id;

  perform pg_catalog.set_config('v1.admin', admin_id::text, true);
  perform pg_catalog.set_config('v1.coa', coa_id::text, true);
  perform pg_catalog.set_config('v1.member', member_id::text, true);
  perform pg_catalog.set_config('v1.own_committee', own_committee::text, true);
  perform pg_catalog.set_config('v1.foreign_committee', foreign_committee::text, true);
  perform pg_catalog.set_config('v1.active', active_id::text, true);
  perform pg_catalog.set_config('v1.ended', ended_id::text, true);
  perform pg_catalog.set_config('v1.source', source_id::text, true);
  perform pg_catalog.set_config('v1.destination', destination_id::text, true);
  perform pg_catalog.set_config(
    'v1.excluded_destination', excluded_destination_id::text, true
  );
  perform pg_catalog.set_config('v1.old_task', old_task_id::text, true);
  perform pg_catalog.set_config('v1.ended_task', ended_task_id::text, true);
  perform pg_catalog.set_config('v1.source_task', source_task_id::text, true);
end;
$fixtures$;

do $catalog$
declare
  c regprocedure :=
    'public.create_active_event_task_step12(uuid,text,text,text,uuid,text,text,timestamptz,timestamptz,timestamptz,uuid[],boolean,uuid[])'::regprocedure;
  e regprocedure :=
    'public.edit_active_event_task_step12(uuid,timestamptz,text,text,text,uuid,text,text,timestamptz,timestamptz,timestamptz,uuid[],boolean,uuid[])'::regprocedure;
  x regprocedure :=
    'public.copy_archived_template_tasks(uuid,uuid,date,uuid[])'::regprocedure;
  cb text;
  eb text;
  xb text;
begin
  select p.prosrc into cb from pg_catalog.pg_proc p where p.oid = c;
  select p.prosrc into eb from pg_catalog.pg_proc p where p.oid = e;
  select p.prosrc into xb from pg_catalog.pg_proc p where p.oid = x;

  perform pg_temp.ok('01 create internal security', (
    select pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      and p.prosecdef and p.provolatile = 'v'
      and p.proconfig = array['search_path=""']
      and not pg_catalog.has_function_privilege('public', p.oid, 'execute')
      and not pg_catalog.has_function_privilege('anon', p.oid, 'execute')
      and not pg_catalog.has_function_privilege('authenticated', p.oid, 'execute')
      and not pg_catalog.has_function_privilege('service_role', p.oid, 'execute')
    from pg_catalog.pg_proc p where p.oid = c
  ));
  perform pg_temp.ok('02 edit internal security', (
    select pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      and p.prosecdef and p.provolatile = 'v'
      and p.proconfig = array['search_path=""']
      and not pg_catalog.has_function_privilege('public', p.oid, 'execute')
      and not pg_catalog.has_function_privilege('anon', p.oid, 'execute')
      and not pg_catalog.has_function_privilege('authenticated', p.oid, 'execute')
      and not pg_catalog.has_function_privilege('service_role', p.oid, 'execute')
    from pg_catalog.pg_proc p where p.oid = e
  ));
  perform pg_temp.ok('03 copier internal security', (
    select pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      and p.prosecdef and p.provolatile = 'v'
      and p.proconfig = array['search_path=""']
      and not pg_catalog.has_function_privilege('public', p.oid, 'execute')
      and not pg_catalog.has_function_privilege('anon', p.oid, 'execute')
      and not pg_catalog.has_function_privilege('authenticated', p.oid, 'execute')
      and not pg_catalog.has_function_privilege('service_role', p.oid, 'execute')
    from pg_catalog.pg_proc p where p.oid = x
  ));
  perform pg_temp.ok('04 create fixed floor codes',
    cb like '%CCD07%' and cb like '%CCD08%' and cb like '%CCD09%');
  perform pg_temp.ok('05 edit changed-only comparisons',
    eb like '%v_stored_due_date at time zone%'
    and eb like '%v_stored_call_time at time zone%'
    and eb like '%v_stored_end_time at time zone%');
  perform pg_temp.ok('06 edit lock and stale precede floor',
    strpos(eb, 'for update') < strpos(eb, 'CCS01')
    and strpos(eb, 'CCS01') < strpos(eb, 'CCD07'));
  perform pg_temp.ok('07 due date column is timestamptz', (
    select a.atttypid = 'timestamptz'::regtype
    from pg_catalog.pg_attribute a
    where a.attrelid = 'public.tasks'::regclass
      and a.attname = 'due_date' and not a.attisdropped
  ));
  perform pg_temp.ok('08 copier signature and typed null schedules',
    xb like '%p_new_start_date%'
    and (length(xb) - length(replace(xb, 'null::timestamptz', '')))
      / length('null::timestamptz') = 3);
end;
$catalog$;

select pg_temp.auth_as(null::uuid);
set local role authenticated;
do $unauthorized$
declare denied boolean := false;
begin
  begin
    perform public.create_active_event_task(
      current_setting('v1.active')::uuid, 'Denied', null, 'Setup',
      current_setting('v1.foreign_committee')::uuid,
      'Deliverable', 'Medium',
      (((statement_timestamp() at time zone 'Asia/Manila')::date - 1)::text
        || ' 00:00:00+00')::timestamptz,
      null, null, '{}', false, '{}'
    );
  exception when sqlstate '42501' then
    denied := true;
  end;
  perform pg_temp.ok('09 authorization precedes date floor', denied);
end;
$unauthorized$;
reset role;

select pg_temp.auth_as(current_setting('v1.admin')::uuid);
set local role authenticated;
do $create_tests$
declare
  today date := (statement_timestamp() at time zone 'Asia/Manila')::date;
  denied boolean;
  created record;
begin
  denied := false;
  begin
    perform public.create_active_event_task(
      current_setting('v1.active')::uuid, 'Past due', null, 'Setup',
      current_setting('v1.foreign_committee')::uuid,
      'Deliverable', 'Medium',
      ((today - 1)::text || ' 00:00:00+00')::timestamptz,
      null, null, '{}', false, '{}'
    );
  exception when others then
    denied := sqlstate = 'CCD07'
      and sqlerrm = 'Choose today or a later due date.';
  end;
  perform pg_temp.ok('10 create rejects past due date fixed', denied);

  denied := false;
  begin
    perform public.create_active_event_task(
      current_setting('v1.active')::uuid, 'Past call', null, 'Setup',
      current_setting('v1.foreign_committee')::uuid,
      'LiveOperation', 'Medium', null,
      pg_temp.local_ts(today - 1, 9, 0), null, '{}', false, '{}'
    );
  exception when others then
    denied := sqlstate = 'CCD08'
      and sqlerrm = 'Choose today or a later duty date.';
  end;
  perform pg_temp.ok('11 create rejects past duty date fixed', denied);

  select * into created from public.create_active_event_task(
    current_setting('v1.active')::uuid, 'Today due', null, 'Setup',
    current_setting('v1.foreign_committee')::uuid,
    'Deliverable', 'Medium',
    (today::text || ' 00:00:00+00')::timestamptz,
    null, null, '{}', false, '{}'
  );
  perform pg_temp.ok('12 create accepts today due', created.out_task_id is not null);
  perform pg_temp.ok('13 due 00 UTC keeps intended date', (
    select task_row.due_date = (today::text || ' 00:00:00+00')::timestamptz
    from public.tasks task_row where task_row.id = created.out_task_id
  ));

  select * into created from public.create_active_event_task(
    current_setting('v1.active')::uuid, 'Elapsed today call', null, 'Setup',
    current_setting('v1.foreign_committee')::uuid,
    'LiveOperation', 'Medium', null,
    pg_temp.local_ts(today, 0, 1), pg_temp.local_ts(today, 0, 2),
    '{}', false, '{}'
  );
  perform pg_temp.ok('14 elapsed time today remains valid',
    created.out_task_id is not null);

  select * into created from public.create_active_event_task(
    current_setting('v1.active')::uuid, 'Overnight today', null, 'Setup',
    current_setting('v1.foreign_committee')::uuid,
    'LiveOperation', 'Medium', null,
    pg_temp.local_ts(today, 23, 0), pg_temp.local_ts(today + 1, 2, 0),
    '{}', false, '{}'
  );
  perform pg_temp.ok('15 overnight end remains valid',
    created.out_task_id is not null);

  denied := false;
  begin
    perform public.create_active_event_task(
      current_setting('v1.ended')::uuid, 'Both floors', null, 'Setup',
      current_setting('v1.foreign_committee')::uuid,
      'Deliverable', 'Medium',
      ((today - 1)::text || ' 00:00:00+00')::timestamptz,
      null, null, '{}', false, '{}'
    );
  exception when sqlstate 'CCD07' then
    denied := true;
  end;
  perform pg_temp.ok('16 create floor precedes event-end error', denied);
end;
$create_tests$;
reset role;

select pg_temp.auth_as(current_setting('v1.admin')::uuid);
set local role authenticated;
do $edit_tests$
declare
  today date := (statement_timestamp() at time zone 'Asia/Manila')::date;
  task_id uuid := current_setting('v1.old_task')::uuid;
  ended_task_id uuid := current_setting('v1.ended_task')::uuid;
  committee_id uuid := current_setting('v1.foreign_committee')::uuid;
  token timestamptz;
  stale_token timestamptz;
  ended_token timestamptz;
  saved record;
  denied boolean;
begin
  select task_row.updated_at into token
  from public.tasks task_row where task_row.id = task_id;

  select * into saved from public.edit_active_event_task(
    task_id, token, 'Unrelated edit', null, 'Setup', committee_id,
    'LiveOperation', 'Medium',
    ((today - 4)::text || ' 00:00:00+00')::timestamptz,
    pg_temp.local_ts(today - 4, 2, 0),
    pg_temp.local_ts(today - 4, 4, 0), '{}', false, '{}'
  );
  perform pg_temp.ok('17 unchanged old dates remain valid',
    saved.out_task_id = task_id);

  stale_token := saved.out_updated_at;
  select * into saved from public.edit_active_event_task(
    task_id, stale_token, 'Time-only edit', null, 'Setup', committee_id,
    'LiveOperation', 'Medium',
    ((today - 4)::text || ' 00:00:00+00')::timestamptz,
    pg_temp.local_ts(today - 4, 3, 0),
    pg_temp.local_ts(today - 4, 5, 0), '{}', false, '{}'
  );
  perform pg_temp.ok('18 time-only old-date edit remains valid',
    saved.out_task_id = task_id);
  token := saved.out_updated_at;

  denied := false;
  begin
    perform public.edit_active_event_task(
      task_id, token, 'Changed past due', null, 'Setup', committee_id,
      'LiveOperation', 'Medium',
      ((today - 1)::text || ' 00:00:00+00')::timestamptz,
      pg_temp.local_ts(today - 4, 3, 0),
      pg_temp.local_ts(today - 4, 5, 0), '{}', false, '{}'
    );
  exception when sqlstate 'CCD07' then denied := true;
  end;
  perform pg_temp.ok('19 edit rejects changed past due date', denied);

  denied := false;
  begin
    perform public.edit_active_event_task(
      task_id, token, 'Changed past duty', null, 'Setup', committee_id,
      'LiveOperation', 'Medium',
      ((today - 4)::text || ' 00:00:00+00')::timestamptz,
      pg_temp.local_ts(today - 2, 3, 0),
      pg_temp.local_ts(today - 2, 5, 0), '{}', false, '{}'
    );
  exception when sqlstate 'CCD08' then denied := true;
  end;
  perform pg_temp.ok('20 edit rejects changed past duty date', denied);

  denied := false;
  begin
    perform public.edit_active_event_task(
      task_id, token, 'Changed past end', null, 'Setup', committee_id,
      'LiveOperation', 'Medium',
      ((today - 4)::text || ' 00:00:00+00')::timestamptz,
      pg_temp.local_ts(today - 4, 3, 0),
      pg_temp.local_ts(today - 1, 5, 0), '{}', false, '{}'
    );
  exception when sqlstate 'CCD09' then denied := true;
  end;
  perform pg_temp.ok('21 edit rejects changed past end date', denied);

  denied := false;
  begin
    perform public.edit_active_event_task(
      task_id, stale_token, 'Stale and past', null, 'Setup', committee_id,
      'LiveOperation', 'Medium',
      ((today - 1)::text || ' 00:00:00+00')::timestamptz,
      pg_temp.local_ts(today - 4, 3, 0),
      pg_temp.local_ts(today - 4, 5, 0), '{}', false, '{}'
    );
  exception when sqlstate 'CCS01' then denied := true;
  end;
  perform pg_temp.ok('22 stale token precedes date floor', denied);

  select task_row.updated_at into ended_token
  from public.tasks task_row where task_row.id = ended_task_id;
  denied := false;
  begin
    perform public.edit_active_event_task(
      ended_task_id, ended_token, 'Past and after event', null, 'Setup',
      committee_id, 'Deliverable', 'Medium',
      ((today - 1)::text || ' 00:00:00+00')::timestamptz,
      null, null, '{}', false, '{}'
    );
  exception when sqlstate 'CCD07' then denied := true;
  end;
  perform pg_temp.ok('23 edit floor precedes event-end error', denied);

  select * into saved from public.edit_active_event_task(
    task_id, token, 'Cleared schedule', null, 'Setup', committee_id,
    'LiveOperation', 'Medium', null, null, null, '{}', false, '{}'
  );
  perform pg_temp.ok('24 clearing old schedules remains valid',
    saved.out_task_id = task_id);
end;
$edit_tests$;
reset role;

select pg_temp.auth_as(current_setting('v1.admin')::uuid);
set local role authenticated;
do $event_create_exemption$
declare
  today date := (statement_timestamp() at time zone 'Asia/Manila')::date;
  created_event uuid;
begin
  created_event := public.create_event_with_tasks(
    'V1 past event fixture', null, today - 12, today - 8, 'Draft',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'title', 'Past event-form task',
      'description', null,
      'phase', 'Setup',
      'committee_id', current_setting('v1.foreign_committee'),
      'task_type', 'Deliverable',
      'priority', 'Medium',
      'due_date', (today - 10)::text,
      'call_time', null,
      'end_time', null,
      'assignee_ids', '[]'::jsonb
    ))
  );
  perform pg_temp.ok('25 event creation keeps past task dates valid',
    created_event is not null and exists(
      select 1 from public.tasks task_row
      where task_row.event_id = created_event
        and (task_row.due_date at time zone 'Asia/Manila')::date = today - 10
    ));
end;
$event_create_exemption$;
reset role;

select pg_temp.auth_as(current_setting('v1.coa')::uuid);
do $direct_copy$
declare
  copied integer;
  excluded integer;
begin
  copied := public.copy_archived_template_tasks(
    current_setting('v1.destination')::uuid,
    current_setting('v1.source')::uuid,
    (statement_timestamp() at time zone 'Asia/Manila')::date + 20,
    '{}'
  );
  perform pg_temp.ok('26 copier return count unchanged', copied = 1);
  perform pg_temp.ok('27 copier blanks every foreign schedule', (
    select task_row.due_date is null
      and task_row.call_time is null
      and task_row.end_time is null
    from public.tasks task_row
    where task_row.event_id = current_setting('v1.destination')::uuid
      and task_row.title = 'Foreign live source'
  ));
  perform pg_temp.ok('28 foreign unscheduled Live Operation remains valid', (
    select task_row.task_type = 'LiveOperation'
    from public.tasks task_row
    where task_row.event_id = current_setting('v1.destination')::uuid
      and task_row.title = 'Foreign live source'
  ));

  excluded := public.copy_archived_template_tasks(
    current_setting('v1.excluded_destination')::uuid,
    current_setting('v1.source')::uuid,
    (statement_timestamp() at time zone 'Asia/Manila')::date + 20,
    array[current_setting('v1.source_task')::uuid]
  );
  perform pg_temp.ok('29 copier exclusion return remains zero', excluded = 0);
end;
$direct_copy$;

set local role authenticated;
do $public_template_copy$
declare
  today date := (statement_timestamp() at time zone 'Asia/Manila')::date;
  created_event uuid;
begin
  created_event := public.create_event_from_archived_template(
    'V1 public template import', null, today + 40, today + 45, 'Active',
    current_setting('v1.source')::uuid, '[]'::jsonb, '[]'::jsonb
  );
  perform pg_catalog.set_config('v1.public_import', created_event::text, true);
  perform pg_temp.ok('30 Co-Admin public template import succeeds',
    created_event is not null);
end;
$public_template_copy$;
reset role;

do $copy_assertions$
begin
  perform pg_temp.ok('31 public import has blank foreign schedule', (
    select task_row.due_date is null
      and task_row.call_time is null
      and task_row.end_time is null
    from public.tasks task_row
    where task_row.event_id = current_setting('v1.public_import')::uuid
      and task_row.title = 'Foreign live source'
  ));
  perform pg_temp.ok('32 confidential source content never copied',
    not exists(
      select 1 from public.tasks task_row
      where task_row.event_id in (
        current_setting('v1.destination')::uuid,
        current_setting('v1.public_import')::uuid
      ) and task_row.title = 'V1 SECRET'
    ));
end;
$copy_assertions$;

select label, passed
from public.v1_guard_test_results
order by label;

do $finish$
declare
  total_count integer;
  pass_count integer;
begin
  select count(*), count(*) filter (where passed)
  into total_count, pass_count
  from public.v1_guard_test_results;

  if total_count <> 32 or pass_count <> 32 then
    raise exception 'TEST RESULTS %/% FAIL — transaction intentionally rolled back',
      pass_count, total_count;
  end if;

  raise exception 'TEST RESULTS 32/32 PASS — transaction intentionally rolled back';
end;
$finish$;
```
