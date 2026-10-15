# Phase 3 Step 6 — Archived task visibility tests

Run the two new migrations first through the owner's normal Dev rollout process.
Do not run these tests against Prod. They expect the documented Dev users:

- Admin: `11111111-1111-1111-1111-111111111111`
- Co-Admin: `22222222-2222-2222-2222-222222222222`
- Member: `33333333-3333-3333-3333-333333333333`

Every block is independent, creates an Active event before its tasks, archives it
only after setup when required, impersonates the relevant caller, and ends in
`rollback`.

## 1. A Member sees a non-confidential Archived task but not a confidential one

```sql
begin;

insert into public.events (id, name, start_date, status, created_by)
values (
  'a6100000-0000-4000-8000-000000000001',
  'Archived visibility test',
  '2026-10-20',
  'Active',
  '11111111-1111-1111-1111-111111111111'
);

insert into public.tasks (id, event_id, committee_id, title, is_confidential)
select
  fixture.id,
  'a6100000-0000-4000-8000-000000000001'::uuid,
  u.committee_id,
  fixture.title,
  fixture.is_confidential
from public.users u
cross join (values
  ('b6100000-0000-4000-8000-000000000001'::uuid, 'Visible archive task', false),
  ('b6100000-0000-4000-8000-000000000002'::uuid, 'Hidden confidential task', true)
) fixture(id, title, is_confidential)
where u.id = '33333333-3333-3333-3333-333333333333';

update public.events
set status = 'Archived'
where id = 'a6100000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333')::text,
  true
);

do $$
begin
  if (select count(*) from public.tasks
      where event_id = 'a6100000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'Expected exactly one visible Archived task';
  end if;

  if not exists (
    select 1 from public.tasks
    where id = 'b6100000-0000-4000-8000-000000000001'
  ) then
    raise exception 'Member could not read the non-confidential Archived task';
  end if;

  if exists (
    select 1 from public.tasks
    where id = 'b6100000-0000-4000-8000-000000000002'
  ) then
    raise exception 'Confidential Archived task leaked to the Member';
  end if;
end
$$;

rollback;
```

## 2. A Member still cannot see an unassigned Active task

```sql
begin;

insert into public.events (id, name, start_date, status, created_by)
values (
  'a6100000-0000-4000-8000-000000000002',
  'Active visibility control',
  '2026-10-20',
  'Active',
  '11111111-1111-1111-1111-111111111111'
);

insert into public.tasks (id, event_id, committee_id, title)
select
  'b6100000-0000-4000-8000-000000000003',
  'a6100000-0000-4000-8000-000000000002',
  committee_id,
  'Unassigned Active task'
from public.users
where id = '33333333-3333-3333-3333-333333333333';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333')::text,
  true
);

do $$
begin
  if exists (
    select 1 from public.tasks
    where id = 'b6100000-0000-4000-8000-000000000003'
  ) then
    raise exception 'The Archived-only branch changed Active task visibility';
  end if;
end
$$;

rollback;
```

## 3. A deactivated user sees no non-confidential Archived task

```sql
begin;

insert into public.events (id, name, start_date, status, created_by)
values (
  'a6100000-0000-4000-8000-000000000003',
  'Inactive caller visibility test',
  '2026-10-20',
  'Active',
  '11111111-1111-1111-1111-111111111111'
);

insert into public.tasks (id, event_id, committee_id, title)
select
  'b6100000-0000-4000-8000-000000000004',
  'a6100000-0000-4000-8000-000000000003',
  committee_id,
  'Archived task hidden from inactive caller'
from public.users
where id = '33333333-3333-3333-3333-333333333333';

update public.events
set status = 'Archived'
where id = 'a6100000-0000-4000-8000-000000000003';

update public.users
set is_active = false
where id = '33333333-3333-3333-3333-333333333333';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333')::text,
  true
);

do $$
begin
  if exists (
    select 1 from public.tasks
    where id = 'b6100000-0000-4000-8000-000000000004'
  ) then
    raise exception 'A deactivated user could read the Archived task';
  end if;
end
$$;

rollback;
```

## 4. A Member still cannot update an Archived task

```sql
begin;

insert into public.events (id, name, start_date, status, created_by)
values (
  'a6100000-0000-4000-8000-000000000004',
  'Archived write freeze test',
  '2026-10-20',
  'Active',
  '11111111-1111-1111-1111-111111111111'
);

insert into public.tasks (
  id, event_id, committee_id, title, primary_assignees
)
select
  'b6100000-0000-4000-8000-000000000005',
  'a6100000-0000-4000-8000-000000000004',
  committee_id,
  'Frozen assigned task',
  array['33333333-3333-3333-3333-333333333333'::uuid]
from public.users
where id = '33333333-3333-3333-3333-333333333333';

update public.events
set status = 'Archived'
where id = 'a6100000-0000-4000-8000-000000000004';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333')::text,
  true
);

do $$
begin
  begin
    update public.tasks
    set status = 'Completed'
    where id = 'b6100000-0000-4000-8000-000000000005';
  exception
    when others then
      if sqlerrm not like '%Tasks in Archived events are read-only%' then
        raise;
      end if;
      return;
  end;

  raise exception 'Member unexpectedly updated an Archived task';
end
$$;

rollback;
```

## 5. The assignee function returns names and only the three allowed fields

```sql
begin;

insert into public.events (id, name, start_date, status, created_by)
values (
  'a6100000-0000-4000-8000-000000000005',
  'Assignee field test',
  '2026-10-20',
  'Active',
  '11111111-1111-1111-1111-111111111111'
);

insert into public.tasks (
  id, event_id, committee_id, title, primary_assignees, assist_assignees
)
select
  'b6100000-0000-4000-8000-000000000006',
  'a6100000-0000-4000-8000-000000000005',
  committee_id,
  'Named Archived task',
  array['33333333-3333-3333-3333-333333333333'::uuid],
  array['22222222-2222-2222-2222-222222222222'::uuid]
from public.users
where id = '33333333-3333-3333-3333-333333333333';

update public.events
set status = 'Archived'
where id = 'a6100000-0000-4000-8000-000000000005';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333')::text,
  true
);

do $$
declare
  payload jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb)
  into payload
  from public.list_archived_event_assignees(
    'a6100000-0000-4000-8000-000000000005'
  ) a;

  if jsonb_array_length(payload) <> 2 then
    raise exception 'Expected both assigned users, got %', payload;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(payload) item
    where not (
      item ? 'id'
      and item ? 'full_name'
      and item ? 'avatar_url'
    )
      or item ?| array['email', 'role', 'discord_id', 'committee_id']
      or (select count(*) from jsonb_object_keys(item)) <> 3
  ) then
    raise exception 'Function returned missing or forbidden profile fields: %', payload;
  end if;

  if exists (
    select 1
    from public.list_archived_event_assignees(
      'a6100000-0000-4000-8000-000000000005'
    ) a
    join public.users u on u.id = a.id
    where a.full_name is distinct from u.full_name
  ) then
    raise exception 'Function did not return the stored assignee names';
  end if;
end
$$;

rollback;
```

## 6. The assignee function returns nothing for an Active event

```sql
begin;

insert into public.events (id, name, start_date, status, created_by)
values (
  'a6100000-0000-4000-8000-000000000006',
  'Active assignee function control',
  '2026-10-20',
  'Active',
  '11111111-1111-1111-1111-111111111111'
);

insert into public.tasks (
  id, event_id, committee_id, title, primary_assignees
)
select
  'b6100000-0000-4000-8000-000000000007',
  'a6100000-0000-4000-8000-000000000006',
  committee_id,
  'Active event assigned task',
  array['33333333-3333-3333-3333-333333333333'::uuid]
from public.users
where id = '33333333-3333-3333-3333-333333333333';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333')::text,
  true
);

do $$
begin
  if exists (
    select 1
    from public.list_archived_event_assignees(
      'a6100000-0000-4000-8000-000000000006'
    )
  ) then
    raise exception 'Assignee function returned rows for an Active event';
  end if;
end
$$;

rollback;
```

## 7. The assignee function returns nothing to a deactivated Member

```sql
begin;

insert into public.events (id, name, start_date, status, created_by)
values (
  'a6100000-0000-4000-8000-000000000007',
  'Inactive assignee caller test',
  '2026-10-20',
  'Active',
  '11111111-1111-1111-1111-111111111111'
);

insert into public.tasks (
  id, event_id, committee_id, title, primary_assignees
)
select
  'b6100000-0000-4000-8000-000000000008',
  'a6100000-0000-4000-8000-000000000007',
  committee_id,
  'Archived task with inactive caller',
  array['33333333-3333-3333-3333-333333333333'::uuid]
from public.users
where id = '33333333-3333-3333-3333-333333333333';

update public.events
set status = 'Archived'
where id = 'a6100000-0000-4000-8000-000000000007';

update public.users
set is_active = false
where id = '33333333-3333-3333-3333-333333333333';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333')::text,
  true
);

do $$
begin
  if exists (
    select 1
    from public.list_archived_event_assignees(
      'a6100000-0000-4000-8000-000000000007'
    )
  ) then
    raise exception 'Assignee function returned rows to a deactivated caller';
  end if;
end
$$;

rollback;
```

## 8. A deactivated assignee still appears by real name

```sql
begin;

insert into public.events (id, name, start_date, status, created_by)
values (
  'a6100000-0000-4000-8000-000000000008',
  'Historical assignee name test',
  '2026-10-20',
  'Active',
  '11111111-1111-1111-1111-111111111111'
);

insert into public.tasks (
  id, event_id, committee_id, title, primary_assignees
)
select
  'b6100000-0000-4000-8000-000000000009',
  'a6100000-0000-4000-8000-000000000008',
  committee_id,
  'Task with later-deactivated assignee',
  array['22222222-2222-2222-2222-222222222222'::uuid]
from public.users
where id = '33333333-3333-3333-3333-333333333333';

update public.events
set status = 'Archived'
where id = 'a6100000-0000-4000-8000-000000000008';

update public.users
set is_active = false
where id = '22222222-2222-2222-2222-222222222222';

select set_config('step6.deactivated_assignee_name', full_name, true)
from public.users
where id = '22222222-2222-2222-2222-222222222222';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333')::text,
  true
);

do $$
begin
  if not exists (
    select 1
    from public.list_archived_event_assignees(
      'a6100000-0000-4000-8000-000000000008'
    ) a
    where a.id = '22222222-2222-2222-2222-222222222222'
      and a.full_name = current_setting('step6.deactivated_assignee_name')
  ) then
    raise exception 'The deactivated assignee was not returned by real name';
  end if;
end
$$;

rollback;
```
