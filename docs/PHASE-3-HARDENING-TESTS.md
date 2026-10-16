# Phase 3 gate hardening — rollback-only SQL tests

Apply `20261015180000_phase_3_gate_hardening.sql` to **Dev only** through the
owner's normal rollout process before running these blocks. Never run them on
Prod. They expect the documented Dev users:

- Admin: `11111111-1111-1111-1111-111111111111`
- CIA Co-Admin: `22222222-2222-2222-2222-222222222222`
- Member: `33333333-3333-3333-3333-333333333333`

Every block is independent and ends in `rollback`. Expected deferred failures
are forced with `set constraints all immediate`; no block writes to or deletes
from `storage.objects`.

## 1. Active callers receive content and deactivated callers receive no row

```sql
begin;

insert into public.events
  (id, name, start_date, end_date, status, created_by)
values
  ('c1000000-0000-4000-8000-000000000001', 'get_task active gate',
   '2026-11-01', '2026-11-02', 'Active',
   '11111111-1111-1111-1111-111111111111');

insert into public.tasks
  (id, event_id, committee_id, title, description, is_confidential,
   primary_assignees)
select
  'd1000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001',
  committee_id,
  'Secret title',
  'Secret description',
  true,
  array['33333333-3333-3333-3333-333333333333'::uuid]
from public.users
where id = '33333333-3333-3333-3333-333333333333';

set constraints all immediate;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333')::text,
  true
);

do $$
begin
  if not exists (
    select 1 from public.get_task('d1000000-0000-4000-8000-000000000001')
    where title = 'Secret title' and description = 'Secret description'
  ) then
    raise exception 'The active assigned Member did not receive real content.';
  end if;
end
$$;

reset role;
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
    select 1 from public.get_task('d1000000-0000-4000-8000-000000000001')
  ) then
    raise exception 'A deactivated assignee received a get_task row.';
  end if;
end
$$;

rollback;
```

## 2. Active insert: empty fails; atomic creation with a task passes

```sql
begin;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111')::text,
  true
);

do $$
begin
  begin
    insert into public.events
      (id, name, start_date, end_date, status, created_by)
    values
      ('c2000000-0000-4000-8000-000000000001', 'Empty Active must fail',
       '2026-11-01', '2026-11-02', 'Active', auth.uid());

    set constraints all immediate;
    raise exception 'Expected empty Active insert rejection.';
  exception when others then
    if position('must have at least one task' in sqlerrm) = 0 then
      raise exception 'Unexpected error: %', sqlerrm;
    end if;
  end;
end
$$;

set constraints all deferred;

select set_config(
  'hardening.active_event_id',
  public.create_event_with_tasks(
    p_name => 'Atomic Active succeeds',
    p_description => null,
    p_start_date => '2026-11-01',
    p_end_date => '2026-11-02',
    p_status => 'Active',
    p_tasks => jsonb_build_array(jsonb_build_object(
      'title', 'Initial task',
      'description', null,
      'phase', 'Setup',
      'committee_id', (select id::text from public.committees order by name limit 1),
      'task_type', 'Deliverable',
      'due_date', null,
      'call_time', null,
      'end_time', null,
      'priority', 'Medium',
      'assignee_ids', jsonb_build_array()
    ))
  )::text,
  true
);

set constraints all immediate;

do $$
begin
  if not exists (
    select 1 from public.tasks
    where event_id = current_setting('hardening.active_event_id')::uuid
  ) then
    raise exception 'Atomic Active creation did not retain its task.';
  end if;
end
$$;

rollback;
```

## 3. Edit RPC: deleting the final task fails; replacing it passes

```sql
begin;

insert into public.events
  (id, name, start_date, end_date, status, created_by)
values
  ('c3000000-0000-4000-8000-000000000001', 'Edit invariant',
   '2026-11-01', '2026-11-02', 'Active',
   '11111111-1111-1111-1111-111111111111');

insert into public.tasks
  (id, event_id, committee_id, title, phase, status)
values
  ('d3000000-0000-4000-8000-000000000001',
   'c3000000-0000-4000-8000-000000000001',
   (select id from public.committees order by name limit 1),
   'Only task', 'Setup', 'To Do');

set constraints all immediate;
set constraints all deferred;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111')::text,
  true
);

do $$
begin
  begin
    perform public.edit_event_with_tasks(
      p_event_id => 'c3000000-0000-4000-8000-000000000001',
      p_expected_updated_at => (select updated_at from public.events
        where id = 'c3000000-0000-4000-8000-000000000001'),
      p_name => 'Edit invariant', p_description => null,
      p_start_date => '2026-11-01', p_end_date => '2026-11-02',
      p_status => 'Active', p_tasks_to_add => '[]'::jsonb,
      p_tasks_to_update => '[]'::jsonb,
      p_task_ids_to_delete => array['d3000000-0000-4000-8000-000000000001'::uuid]
    );
    set constraints all immediate;
    raise exception 'Expected final Active task deletion rejection.';
  exception when others then
    if position('must have at least one task' in sqlerrm) = 0 then
      raise exception 'Unexpected error: %', sqlerrm;
    end if;
  end;
end
$$;

set constraints all deferred;

select public.edit_event_with_tasks(
  p_event_id => 'c3000000-0000-4000-8000-000000000001',
  p_expected_updated_at => (select updated_at from public.events
    where id = 'c3000000-0000-4000-8000-000000000001'),
  p_name => 'Edit invariant', p_description => null,
  p_start_date => '2026-11-01', p_end_date => '2026-11-02',
  p_status => 'Active',
  p_tasks_to_add => jsonb_build_array(jsonb_build_object(
    'title', 'Replacement task', 'description', null, 'phase', 'Setup',
    'committee_id', (select id::text from public.committees order by name limit 1),
    'task_type', 'Deliverable', 'due_date', null, 'call_time', null,
    'end_time', null, 'priority', 'Medium',
    'assignee_ids', jsonb_build_array()
  )),
  p_tasks_to_update => '[]'::jsonb,
  p_task_ids_to_delete => array['d3000000-0000-4000-8000-000000000001'::uuid]
);

set constraints all immediate;

do $$
begin
  if (select count(*) from public.tasks
      where event_id = 'c3000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'The valid same-save task replacement failed.';
  end if;
end
$$;

rollback;
```

## 4. Moving tasks: emptying a source fails; swapping final state passes

```sql
begin;

insert into public.events
  (id, name, start_date, end_date, status, created_by)
values
  ('c4000000-0000-4000-8000-000000000001', 'Move source',
   '2026-11-01', '2026-11-02', 'Active', '11111111-1111-1111-1111-111111111111'),
  ('c4000000-0000-4000-8000-000000000002', 'Move target',
   '2026-11-01', '2026-11-02', 'Active', '11111111-1111-1111-1111-111111111111');

insert into public.tasks (id, event_id, committee_id, title, phase)
values
  ('d4000000-0000-4000-8000-000000000001',
   'c4000000-0000-4000-8000-000000000001',
   (select id from public.committees order by name limit 1), 'Source task', 'Setup'),
  ('d4000000-0000-4000-8000-000000000002',
   'c4000000-0000-4000-8000-000000000002',
   (select id from public.committees order by name limit 1), 'Target task', 'Setup');

set constraints all immediate;
set constraints all deferred;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111')::text,
  true
);

do $$
begin
  begin
    update public.tasks
    set event_id = 'c4000000-0000-4000-8000-000000000002'
    where id = 'd4000000-0000-4000-8000-000000000001';
    set constraints all immediate;
    raise exception 'Expected source-emptying move rejection.';
  exception when others then
    if position('must have at least one task' in sqlerrm) = 0 then
      raise exception 'Unexpected error: %', sqlerrm;
    end if;
  end;
end
$$;

set constraints all deferred;

update public.tasks
set event_id = case id
  when 'd4000000-0000-4000-8000-000000000001'::uuid
    then 'c4000000-0000-4000-8000-000000000002'::uuid
  else 'c4000000-0000-4000-8000-000000000001'::uuid
end
where id in (
  'd4000000-0000-4000-8000-000000000001',
  'd4000000-0000-4000-8000-000000000002'
);

set constraints all immediate;

rollback;
```

## 5. Launch requires an end date; legacy Active null-end rows remain editable

```sql
begin;

insert into public.events (id, name, start_date, status, created_by)
values
  ('c5000000-0000-4000-8000-000000000001', 'Launch rule',
   '2026-11-01', 'Draft', '11111111-1111-1111-1111-111111111111');

insert into public.tasks (id, event_id, committee_id, title, phase)
values
  ('d5000000-0000-4000-8000-000000000001',
   'c5000000-0000-4000-8000-000000000001',
   (select id from public.committees order by name limit 1), 'Launch task', 'Setup');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111')::text,
  true
);

do $$
begin
  begin
    update public.events set status = 'Active'
    where id = 'c5000000-0000-4000-8000-000000000001';
    raise exception 'Expected launch-without-end-date rejection.';
  exception when others then
    if position('requires an end date' in sqlerrm) = 0 then
      raise exception 'Unexpected error: %', sqlerrm;
    end if;
  end;
end
$$;

update public.events
set end_date = '2026-11-02', status = 'Active'
where id = 'c5000000-0000-4000-8000-000000000001';

reset role;

insert into public.events
  (id, name, start_date, end_date, status, created_by)
values
  ('c5000000-0000-4000-8000-000000000002', 'Legacy null end',
   '2026-11-01', null, 'Active', '11111111-1111-1111-1111-111111111111');
insert into public.tasks (event_id, committee_id, title, phase)
values
  ('c5000000-0000-4000-8000-000000000002',
   (select id from public.committees order by name limit 1), 'Legacy task', 'Setup');
set constraints all immediate;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111')::text,
  true
);
update public.events
set name = 'Legacy null end remains editable'
where id = 'c5000000-0000-4000-8000-000000000002';

rollback;
```

## 6. Real archive path stays frozen; Active event deletion still works

> Step 1 supersedes the former raw Admin archive; this test now uses `archive_event()`.

```sql
begin;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111')::text,
  true
);

select set_config(
  'hardening.archive_event_id',
  public.create_event_with_tasks(
    'Archive path', null, '2026-11-01', '2026-11-02', 'Active',
    jsonb_build_array(jsonb_build_object(
      'title', 'Frozen task', 'description', null, 'phase', 'Setup',
      'committee_id', (select id::text from public.committees order by name limit 1),
      'task_type', 'Deliverable', 'due_date', null, 'call_time', null,
      'end_time', null, 'priority', 'Medium', 'assignee_ids', jsonb_build_array()
    ))
  )::text,
  true
);

set constraints all immediate;
set constraints all deferred;

do $$
declare
  v_event_id uuid := current_setting('hardening.archive_event_id')::uuid;
  v_expected_incomplete_task_count bigint;
  v_expected_updated_at timestamptz;
begin
  select
    count(*) filter (where t.status <> 'Completed'),
    e.updated_at
  into v_expected_incomplete_task_count, v_expected_updated_at
  from public.events e
  left join public.tasks t on t.event_id = e.id
  where e.id = v_event_id
  group by e.updated_at;

  perform public.archive_event(
    v_event_id,
    v_expected_incomplete_task_count,
    v_expected_updated_at
  );

  if not exists (
    select 1
    from public.events
    where id = v_event_id
      and status = 'Archived'
  ) then
    raise exception 'Expected archive_event() to set the fixture event status to Archived.';
  end if;
end
$$;

do $$
begin
  begin
    delete from public.tasks
    where event_id = current_setting('hardening.archive_event_id')::uuid;
    raise exception 'Expected Archived task freeze.';
  exception when others then
    if position('Tasks in Archived events are read-only' in sqlerrm) = 0 then
      raise exception 'Unexpected error: %', sqlerrm;
    end if;
  end;
end
$$;

reset role;
insert into public.events
  (id, name, start_date, end_date, status, created_by)
values
  ('c6000000-0000-4000-8000-000000000002', 'Deletable Active',
   '2026-11-01', '2026-11-02', 'Active', '11111111-1111-1111-1111-111111111111');
insert into public.tasks (event_id, committee_id, title, phase)
values
  ('c6000000-0000-4000-8000-000000000002',
   (select id from public.committees order by name limit 1), 'Deleted with parent', 'Setup');
set constraints all immediate;
set constraints all deferred;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111')::text,
  true
);
delete from public.events
where id = 'c6000000-0000-4000-8000-000000000002';
set constraints all immediate;

rollback;
```

## 7. Co-Admin is protected by the invariant and still cannot archive

```sql
begin;

insert into public.events
  (id, name, start_date, end_date, status, created_by)
values
  ('c7000000-0000-4000-8000-000000000001', 'Co-Admin invariant',
   '2026-11-01', '2026-11-02', 'Active',
   '11111111-1111-1111-1111-111111111111');
insert into public.tasks (id, event_id, committee_id, title, phase)
select
  'd7000000-0000-4000-8000-000000000001',
  'c7000000-0000-4000-8000-000000000001',
  committee_id, 'Own committee task', 'Setup'
from public.users
where id = '22222222-2222-2222-2222-222222222222';
set constraints all immediate;
set constraints all deferred;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222')::text,
  true
);

do $$
begin
  begin
    delete from public.tasks
    where id = 'd7000000-0000-4000-8000-000000000001';
    set constraints all immediate;
    raise exception 'Expected Co-Admin final-task rejection.';
  exception when others then
    if position('must have at least one task' in sqlerrm) = 0 then
      raise exception 'Unexpected error: %', sqlerrm;
    end if;
  end;
end
$$;

do $$
begin
  begin
    update public.events
    set status = 'Archived'
    where id = 'c7000000-0000-4000-8000-000000000001';
  exception when insufficient_privilege then
    null;
  end;
end
$$;

do $$
begin
  if (select status from public.events
      where id = 'c7000000-0000-4000-8000-000000000001') <> 'Active' then
    raise exception 'Co-Admin archived the event.';
  end if;
end
$$;

rollback;
```

## 8. Member cannot create or mutate events/tasks

```sql
begin;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333')::text,
  true
);

do $$
begin
  begin
    insert into public.events
      (name, start_date, end_date, status, created_by)
    values ('Member forbidden', '2026-11-01', '2026-11-02', 'Active', auth.uid());
    raise exception 'Expected Member event insert rejection.';
  exception when others then
    if position('row-level security' in sqlerrm) = 0 then
      raise exception 'Unexpected error: %', sqlerrm;
    end if;
  end;
end
$$;

rollback;
```
