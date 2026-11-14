# Phase 3 Step 4 — Edit Event tests

Run the migration first through the owner's normal Dev rollout process. Do not
run these against Prod. The SQL tests expect the documented Dev users:

- Admin: `11111111-1111-1111-1111-111111111111`
- CIA Co-Admin: `22222222-2222-2222-2222-222222222222`
- Member: `33333333-3333-3333-3333-333333333333`

Every SQL block is independent, creates its own fixtures, and ends in
`rollback`, so successful test data is not retained.

## 1. Stale `updated_at` is rejected

```sql
begin;

insert into public.events (id, name, start_date, status, created_by)
values (
  'a1000000-0000-4000-8000-000000000001',
  'Step 4 stale test',
  '2026-10-20',
  'Draft',
  '11111111-1111-1111-1111-111111111111'
);

select set_config(
  'step4.expected_updated_at',
  updated_at::text,
  true
)
from public.events
where id = 'a1000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111')::text,
  true
);

select public.edit_event_with_tasks(
  p_event_id => 'a1000000-0000-4000-8000-000000000001',
  p_expected_updated_at => current_setting('step4.expected_updated_at')::timestamptz,
  p_name => 'First save wins',
  p_description => null,
  p_start_date => '2026-10-20',
  p_end_date => null,
  p_status => 'Draft',
  p_tasks_to_add => '[]'::jsonb,
  p_tasks_to_update => '[]'::jsonb,
  p_task_ids_to_delete => '{}'::uuid[]
,
      p_phase_actions => '[]'::jsonb
    );

do $$
begin
  begin
    perform public.edit_event_with_tasks(
      p_event_id => 'a1000000-0000-4000-8000-000000000001',
      p_expected_updated_at => current_setting('step4.expected_updated_at')::timestamptz,
      p_name => 'Stale save must lose',
      p_description => null,
      p_start_date => '2026-10-20',
      p_end_date => null,
      p_status => 'Draft',
      p_tasks_to_add => jsonb_build_array(jsonb_build_object(
        'title', 'Must roll back',
        'description', null,
        'phase', 'Setup',
        'committee_id', (select id::text from public.committees order by name limit 1),
        'task_type', 'Deliverable',
        'due_date', null,
        'call_time', null,
        'end_time', null,
        'priority', 'Medium',
        'assignee_ids', jsonb_build_array()
      )),
      p_tasks_to_update => '[]'::jsonb,
      p_task_ids_to_delete => '{}'::uuid[]
    ,
      p_phase_actions => '[]'::jsonb
    );
    raise exception 'Expected stale-save rejection but the call succeeded.';
  exception when others then
    if position('changed after you loaded it' in sqlerrm) = 0 then
      raise exception 'Unexpected error: %', sqlerrm;
    end if;
  end;
end;
$$;

reset role;

do $$
begin
  if (select name from public.events where id = 'a1000000-0000-4000-8000-000000000001') <> 'First save wins' then
    raise exception 'The stale save overwrote the winning save.';
  end if;
  if exists (
    select 1 from public.tasks
    where event_id = 'a1000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'The stale save left a task behind.';
  end if;
end;
$$;

rollback;
```

## Inactive-assignee A. Updating a title while an existing assignment remains succeeds

```sql
begin;

update public.users
set is_active = false
where id = '33333333-3333-3333-3333-333333333333';

insert into public.events (id, name, start_date, status, created_by)
values (
  'a7000000-0000-4000-8000-000000000007',
  'Existing inactive assignee test',
  '2026-10-20',
  'Draft',
  '11111111-1111-1111-1111-111111111111'
);

insert into public.tasks (
  id, event_id, committee_id, title, phase, primary_assignees
)
values (
  'b7000000-0000-4000-8000-000000000071',
  'a7000000-0000-4000-8000-000000000007',
  (select id from public.committees order by name limit 1),
  'Original title',
  'Setup',
  array['33333333-3333-3333-3333-333333333333'::uuid]
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111')::text,
  true
);

select public.edit_event_with_tasks(
  p_event_id => 'a7000000-0000-4000-8000-000000000007',
  p_expected_updated_at => (
    select updated_at from public.events
    where id = 'a7000000-0000-4000-8000-000000000007'
  ),
  p_name => 'Existing inactive assignee test',
  p_description => null,
  p_start_date => '2026-10-20',
  p_end_date => null,
  p_status => 'Draft',
  p_tasks_to_add => '[]'::jsonb,
  p_tasks_to_update => jsonb_build_array(jsonb_build_object(
    'id', 'b7000000-0000-4000-8000-000000000071',
    'title', 'Updated title',
    'description', null,
    'phase', 'Setup',
    'committee_id', (select id::text from public.committees order by name limit 1),
    'task_type', 'Deliverable',
    'due_date', null,
    'call_time', null,
    'end_time', null,
    'priority', 'Medium',
    'assignee_ids', jsonb_build_array('33333333-3333-3333-3333-333333333333')
  )),
  p_task_ids_to_delete => '{}'::uuid[]
,
      p_phase_actions => '[]'::jsonb
    );

reset role;

do $$
begin
  if not exists (
    select 1 from public.tasks
    where id = 'b7000000-0000-4000-8000-000000000071'
      and title = 'Updated title'
      and primary_assignees = array['33333333-3333-3333-3333-333333333333'::uuid]
  ) then
    raise exception 'The title update or retained inactive assignment failed.';
  end if;
end;
$$;

rollback;
```

## Inactive-assignee B. Adding a new inactive assignee is rejected atomically

```sql
begin;

update public.users
set is_active = false
where id = '33333333-3333-3333-3333-333333333333';

insert into public.events (id, name, start_date, status, created_by)
values (
  'a7100000-0000-4000-8000-000000000008',
  'New inactive assignee test',
  '2026-10-20',
  'Draft',
  '11111111-1111-1111-1111-111111111111'
);

insert into public.tasks (id, event_id, committee_id, title, phase)
values (
  'b7100000-0000-4000-8000-000000000081',
  'a7100000-0000-4000-8000-000000000008',
  (select id from public.committees order by name limit 1),
  'No assignees yet',
  'Setup'
);

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
      p_event_id => 'a7100000-0000-4000-8000-000000000008',
      p_expected_updated_at => (
        select updated_at from public.events
        where id = 'a7100000-0000-4000-8000-000000000008'
      ),
      p_name => 'Rejected inactive addition',
      p_description => null,
      p_start_date => '2026-10-20',
      p_end_date => null,
      p_status => 'Draft',
      p_tasks_to_add => '[]'::jsonb,
      p_tasks_to_update => jsonb_build_array(jsonb_build_object(
        'id', 'b7100000-0000-4000-8000-000000000081',
        'title', 'Must roll back',
        'description', null,
        'phase', 'Setup',
        'committee_id', (select id::text from public.committees order by name limit 1),
        'task_type', 'Deliverable',
        'due_date', null,
        'call_time', null,
        'end_time', null,
        'priority', 'Medium',
        'assignee_ids', jsonb_build_array('33333333-3333-3333-3333-333333333333')
      )),
      p_task_ids_to_delete => '{}'::uuid[]
    ,
      p_phase_actions => '[]'::jsonb
    );
    raise exception 'Expected new inactive-assignee rejection but the call succeeded.';
  exception when others then
    if position('newly added assignees must be active' in sqlerrm) = 0 then
      raise exception 'Unexpected error: %', sqlerrm;
    end if;
  end;
end;
$$;

reset role;

do $$
begin
  if not exists (
    select 1 from public.tasks
    where id = 'b7100000-0000-4000-8000-000000000081'
      and title = 'No assignees yet'
      and primary_assignees = '{}'::uuid[]
  ) then
    raise exception 'The rejected save changed the task.';
  end if;
  if (select name from public.events where id = 'a7100000-0000-4000-8000-000000000008') <> 'New inactive assignee test' then
    raise exception 'The rejected save changed the event.';
  end if;
end;
$$;

rollback;
```

## Inactive-assignee C. Removing an existing inactive assignee succeeds

```sql
begin;

update public.users
set is_active = false
where id = '33333333-3333-3333-3333-333333333333';

insert into public.events (id, name, start_date, status, created_by)
values (
  'a7200000-0000-4000-8000-000000000009',
  'Remove inactive assignee test',
  '2026-10-20',
  'Draft',
  '11111111-1111-1111-1111-111111111111'
);

insert into public.tasks (
  id, event_id, committee_id, title, phase, primary_assignees
)
values (
  'b7200000-0000-4000-8000-000000000091',
  'a7200000-0000-4000-8000-000000000009',
  (select id from public.committees order by name limit 1),
  'Remove inactive assignment',
  'Setup',
  array['33333333-3333-3333-3333-333333333333'::uuid]
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111')::text,
  true
);

select public.edit_event_with_tasks(
  p_event_id => 'a7200000-0000-4000-8000-000000000009',
  p_expected_updated_at => (
    select updated_at from public.events
    where id = 'a7200000-0000-4000-8000-000000000009'
  ),
  p_name => 'Remove inactive assignee test',
  p_description => null,
  p_start_date => '2026-10-20',
  p_end_date => null,
  p_status => 'Draft',
  p_tasks_to_add => '[]'::jsonb,
  p_tasks_to_update => jsonb_build_array(jsonb_build_object(
    'id', 'b7200000-0000-4000-8000-000000000091',
    'title', 'Remove inactive assignment',
    'description', null,
    'phase', 'Setup',
    'committee_id', (select id::text from public.committees order by name limit 1),
    'task_type', 'Deliverable',
    'due_date', null,
    'call_time', null,
    'end_time', null,
    'priority', 'Medium',
    'assignee_ids', jsonb_build_array()
  )),
  p_task_ids_to_delete => '{}'::uuid[]
,
      p_phase_actions => '[]'::jsonb
    );

reset role;

do $$
begin
  if (select primary_assignees from public.tasks where id = 'b7200000-0000-4000-8000-000000000091') <> '{}'::uuid[] then
    raise exception 'The inactive assignee was not removed.';
  end if;
end;
$$;

rollback;
```

## Inactive-assignee D. A Co-Admin may retain one on an own-committee task

```sql
begin;

update public.users
set is_active = false
where id = '33333333-3333-3333-3333-333333333333';

insert into public.events (id, name, start_date, status, created_by)
values (
  'a7300000-0000-4000-8000-000000000010',
  'Co-Admin inactive assignee test',
  '2026-10-20',
  'Draft',
  '11111111-1111-1111-1111-111111111111'
);

insert into public.tasks (
  id, event_id, committee_id, title, phase, primary_assignees
)
values (
  'b7300000-0000-4000-8000-000000000101',
  'a7300000-0000-4000-8000-000000000010',
  (select committee_id from public.users where id = '22222222-2222-2222-2222-222222222222'),
  'Co-Admin original title',
  'Setup',
  array['33333333-3333-3333-3333-333333333333'::uuid]
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222')::text,
  true
);

select public.edit_event_with_tasks(
  p_event_id => 'a7300000-0000-4000-8000-000000000010',
  p_expected_updated_at => (
    select updated_at from public.events
    where id = 'a7300000-0000-4000-8000-000000000010'
  ),
  p_name => 'Co-Admin inactive assignee test',
  p_description => null,
  p_start_date => '2026-10-20',
  p_end_date => null,
  p_status => 'Draft',
  p_tasks_to_add => '[]'::jsonb,
  p_tasks_to_update => jsonb_build_array(jsonb_build_object(
    'id', 'b7300000-0000-4000-8000-000000000101',
    'title', 'Co-Admin updated title',
    'description', null,
    'phase', 'Setup',
    'committee_id', public.my_committee_id()::text,
    'task_type', 'Deliverable',
    'due_date', null,
    'call_time', null,
    'end_time', null,
    'priority', 'Medium',
    'assignee_ids', jsonb_build_array('33333333-3333-3333-3333-333333333333')
  )),
  p_task_ids_to_delete => '{}'::uuid[]
,
      p_phase_actions => '[]'::jsonb
    );

reset role;

do $$
begin
  if not exists (
    select 1 from public.tasks
    where id = 'b7300000-0000-4000-8000-000000000101'
      and title = 'Co-Admin updated title'
      and primary_assignees = array['33333333-3333-3333-3333-333333333333'::uuid]
  ) then
    raise exception 'The Co-Admin update or retained inactive assignment failed.';
  end if;
end;
$$;

rollback;
```

## 2. Co-Admin cross-committee update and delete are rejected atomically

```sql
begin;

insert into public.events (id, name, start_date, status, created_by)
values (
  'a2000000-0000-4000-8000-000000000002',
  'Step 4 Co-Admin scope test',
  '2026-10-20',
  'Draft',
  '11111111-1111-1111-1111-111111111111'
);

insert into public.tasks (id, event_id, committee_id, title, phase, status)
values
  (
    'b2000000-0000-4000-8000-000000000021',
    'a2000000-0000-4000-8000-000000000002',
    (select committee_id from public.users where id = '22222222-2222-2222-2222-222222222222'),
    'Own committee original',
    'Setup',
    'To Do'
  ),
  (
    'b2000000-0000-4000-8000-000000000022',
    'a2000000-0000-4000-8000-000000000002',
    (
      select id from public.committees
      where id <> (select committee_id from public.users where id = '22222222-2222-2222-2222-222222222222')
      order by name
      limit 1
    ),
    'Other committee original',
    'Setup',
    'To Do'
  );

select set_config(
  'step4.expected_updated_at',
  updated_at::text,
  true
)
from public.events
where id = 'a2000000-0000-4000-8000-000000000002';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222')::text,
  true
);

do $$
begin
  begin
    perform public.edit_event_with_tasks(
      p_event_id => 'a2000000-0000-4000-8000-000000000002',
      p_expected_updated_at => current_setting('step4.expected_updated_at')::timestamptz,
      p_name => 'Cross update must fail',
      p_description => null,
      p_start_date => '2026-10-20',
      p_end_date => null,
      p_status => 'Draft',
      p_tasks_to_add => '[]'::jsonb,
      p_tasks_to_update => jsonb_build_array(
        jsonb_build_object(
          'id', 'b2000000-0000-4000-8000-000000000021',
          'title', 'Own committee attempted change',
          'description', null,
          'phase', 'Setup',
          'committee_id', public.my_committee_id()::text,
          'task_type', 'Deliverable',
          'due_date', null,
          'call_time', null,
          'end_time', null,
          'priority', 'Medium',
          'assignee_ids', jsonb_build_array()
        ),
        jsonb_build_object(
          'id', 'b2000000-0000-4000-8000-000000000022',
          'title', 'Forbidden cross-committee change',
          'description', null,
          'phase', 'Setup',
          'committee_id', (
            select id::text from public.committees
            where id <> public.my_committee_id()
            order by name
            limit 1
          ),
          'task_type', 'Deliverable',
          'due_date', null,
          'call_time', null,
          'end_time', null,
          'priority', 'Medium',
          'assignee_ids', jsonb_build_array()
        )
      ),
      p_task_ids_to_delete => '{}'::uuid[]
    ,
      p_phase_actions => '[]'::jsonb
    );
    raise exception 'Expected cross-committee update rejection but the call succeeded.';
  exception when others then
    if position('not available' in sqlerrm) = 0
       and position('own committee' in sqlerrm) = 0 then
      raise exception 'Unexpected update error: %', sqlerrm;
    end if;
  end;
end;
$$;

do $$
begin
  begin
    perform public.edit_event_with_tasks(
      p_event_id => 'a2000000-0000-4000-8000-000000000002',
      p_expected_updated_at => current_setting('step4.expected_updated_at')::timestamptz,
      p_name => 'Cross delete must fail',
      p_description => null,
      p_start_date => '2026-10-20',
      p_end_date => null,
      p_status => 'Draft',
      p_tasks_to_add => '[]'::jsonb,
      p_tasks_to_update => jsonb_build_array(jsonb_build_object(
        'id', 'b2000000-0000-4000-8000-000000000021',
        'title', 'Own update must roll back',
        'description', null,
        'phase', 'Setup',
        'committee_id', public.my_committee_id()::text,
        'task_type', 'Deliverable',
        'due_date', null,
        'call_time', null,
        'end_time', null,
        'priority', 'Medium',
        'assignee_ids', jsonb_build_array()
      )),
      p_task_ids_to_delete => array['b2000000-0000-4000-8000-000000000022'::uuid]
    ,
      p_phase_actions => '[]'::jsonb
    );
    raise exception 'Expected cross-committee delete rejection but the call succeeded.';
  exception when others then
    if position('not available' in sqlerrm) = 0
       and position('own committee' in sqlerrm) = 0 then
      raise exception 'Unexpected delete error: %', sqlerrm;
    end if;
  end;
end;
$$;

reset role;

do $$
begin
  if (select name from public.events where id = 'a2000000-0000-4000-8000-000000000002') <> 'Step 4 Co-Admin scope test' then
    raise exception 'A rejected Co-Admin save changed the event.';
  end if;
  if (select title from public.tasks where id = 'b2000000-0000-4000-8000-000000000021') <> 'Own committee original' then
    raise exception 'A permitted earlier update was not rolled back.';
  end if;
  if (select title from public.tasks where id = 'b2000000-0000-4000-8000-000000000022') <> 'Other committee original' then
    raise exception 'The other committee task changed or was deleted.';
  end if;
end;
$$;

rollback;
```

## 3. A non-To-Do task cannot be deleted

```sql
begin;

insert into public.events (id, name, start_date, status, created_by)
values (
  'a3000000-0000-4000-8000-000000000003',
  'Step 4 progress delete test',
  '2026-10-20',
  'Draft',
  '11111111-1111-1111-1111-111111111111'
);

insert into public.tasks (id, event_id, committee_id, title, phase, status)
values (
  'b3000000-0000-4000-8000-000000000031',
  'a3000000-0000-4000-8000-000000000003',
  (select id from public.committees order by name limit 1),
  'Work already started',
  'Setup',
  'In Progress'
);

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
      p_event_id => 'a3000000-0000-4000-8000-000000000003',
      p_expected_updated_at => (
        select updated_at from public.events
        where id = 'a3000000-0000-4000-8000-000000000003'
      ),
      p_name => 'Rejected delete',
      p_description => null,
      p_start_date => '2026-10-20',
      p_end_date => null,
      p_status => 'Draft',
      p_tasks_to_add => jsonb_build_array(jsonb_build_object(
        'title', 'Addition must roll back',
        'description', null,
        'phase', 'Setup',
        'committee_id', (select id::text from public.committees order by name limit 1),
        'task_type', 'Deliverable',
        'due_date', null,
        'call_time', null,
        'end_time', null,
        'priority', 'Medium',
        'assignee_ids', jsonb_build_array()
      )),
      p_tasks_to_update => '[]'::jsonb,
      p_task_ids_to_delete => array['b3000000-0000-4000-8000-000000000031'::uuid]
    ,
      p_phase_actions => '[]'::jsonb
    );
    raise exception 'Expected progressed-task deletion rejection but the call succeeded.';
  exception when others then
    if position('Only To Do tasks can be deleted' in sqlerrm) = 0 then
      raise exception 'Unexpected error: %', sqlerrm;
    end if;
  end;
end;
$$;

reset role;

do $$
begin
  if not exists (
    select 1 from public.tasks
    where id = 'b3000000-0000-4000-8000-000000000031'
      and status = 'In Progress'
  ) then
    raise exception 'The progressed task was deleted.';
  end if;
  if exists (
    select 1 from public.tasks
    where event_id = 'a3000000-0000-4000-8000-000000000003'
      and title = 'Addition must roll back'
  ) then
    raise exception 'The failed save left its earlier addition behind.';
  end if;
end;
$$;

rollback;
```

## 4. A task omitted from all mutation lists is unchanged

```sql
begin;

insert into public.events (id, name, start_date, status, created_by)
values (
  'a4000000-0000-4000-8000-000000000004',
  'Step 4 omitted task test',
  '2026-10-20',
  'Draft',
  '11111111-1111-1111-1111-111111111111'
);

insert into public.tasks (id, event_id, committee_id, title, description, phase, status)
values
  (
    'b4000000-0000-4000-8000-000000000041',
    'a4000000-0000-4000-8000-000000000004',
    (select id from public.committees order by name limit 1),
    'Explicitly updated task',
    null,
    'Setup',
    'To Do'
  ),
  (
    'b4000000-0000-4000-8000-000000000042',
    'a4000000-0000-4000-8000-000000000004',
    (select id from public.committees order by name limit 1),
    'Omitted task original',
    'Must remain exactly as-is',
    'Setup',
    'To Do'
  );

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111')::text,
  true
);

select public.edit_event_with_tasks(
  p_event_id => 'a4000000-0000-4000-8000-000000000004',
  p_expected_updated_at => (
    select updated_at from public.events
    where id = 'a4000000-0000-4000-8000-000000000004'
  ),
  p_name => 'Event save succeeded',
  p_description => null,
  p_start_date => '2026-10-20',
  p_end_date => null,
  p_status => 'Draft',
  p_tasks_to_add => '[]'::jsonb,
  p_tasks_to_update => jsonb_build_array(jsonb_build_object(
    'id', 'b4000000-0000-4000-8000-000000000041',
    'title', 'Explicit update saved',
    'description', null,
    'phase', 'Setup',
    'committee_id', (select id::text from public.committees order by name limit 1),
    'task_type', 'Deliverable',
    'due_date', null,
    'call_time', null,
    'end_time', null,
    'priority', 'Medium',
    'assignee_ids', jsonb_build_array()
  )),
  p_task_ids_to_delete => '{}'::uuid[]
,
      p_phase_actions => '[]'::jsonb
    );

reset role;

do $$
begin
  if (select title from public.tasks where id = 'b4000000-0000-4000-8000-000000000041') <> 'Explicit update saved' then
    raise exception 'The explicit task update did not save.';
  end if;
  if not exists (
    select 1 from public.tasks
    where id = 'b4000000-0000-4000-8000-000000000042'
      and title = 'Omitted task original'
      and description = 'Must remain exactly as-is'
      and status = 'To Do'
  ) then
    raise exception 'The omitted task changed.';
  end if;
end;
$$;

rollback;
```

## 5. A Member cannot call the function

```sql
begin;

insert into public.events (id, name, start_date, status, created_by)
values (
  'a5000000-0000-4000-8000-000000000005',
  'Step 4 Member test',
  '2026-10-20',
  'Active',
  '11111111-1111-1111-1111-111111111111'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333')::text,
  true
);

do $$
begin
  begin
    perform public.edit_event_with_tasks(
      p_event_id => 'a5000000-0000-4000-8000-000000000005',
      p_expected_updated_at => (
        select updated_at from public.events
        where id = 'a5000000-0000-4000-8000-000000000005'
      ),
      p_name => 'Member must not save',
      p_description => null,
      p_start_date => '2026-10-20',
      p_end_date => '2026-10-21',
      p_status => 'Active',
      p_tasks_to_add => '[]'::jsonb,
      p_tasks_to_update => '[]'::jsonb,
      p_task_ids_to_delete => '{}'::uuid[]
    ,
      p_phase_actions => '[]'::jsonb
    );
    raise exception 'Expected Member rejection but the call succeeded.';
  exception when others then
    if position('Only active Admins and Co-Admins can edit events' in sqlerrm) = 0 then
      raise exception 'Unexpected error: %', sqlerrm;
    end if;
  end;
end;
$$;

reset role;

do $$
begin
  if (select name from public.events where id = 'a5000000-0000-4000-8000-000000000005') <> 'Step 4 Member test' then
    raise exception 'The Member changed the event.';
  end if;
end;
$$;

rollback;
```

## 6. Draft-to-Active succeeds with a task added in the same save

```sql
begin;

insert into public.events (id, name, start_date, status, created_by)
values (
  'a6000000-0000-4000-8000-000000000006',
  'Step 4 same-save launch test',
  '2026-10-20',
  'Draft',
  '11111111-1111-1111-1111-111111111111'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111')::text,
  true
);

select public.edit_event_with_tasks(
  p_event_id => 'a6000000-0000-4000-8000-000000000006',
  p_expected_updated_at => (
    select updated_at from public.events
    where id = 'a6000000-0000-4000-8000-000000000006'
  ),
  p_name => 'Launched with same-save task',
  p_description => null,
  p_start_date => '2026-10-20',
  p_end_date => '2026-10-21',
  p_status => 'Active',
  p_tasks_to_add => jsonb_build_array(jsonb_build_object(
    'title', 'Launch-enabling task',
    'description', null,
    'phase', 'Setup',
    'committee_id', (select id::text from public.committees order by name limit 1),
    'task_type', 'Deliverable',
    'due_date', '2026-10-19',
    'call_time', null,
    'end_time', null,
    'priority', 'Medium',
    'assignee_ids', jsonb_build_array()
  )),
  p_tasks_to_update => '[]'::jsonb,
  p_task_ids_to_delete => '{}'::uuid[]
,
      p_phase_actions => '[]'::jsonb
    );

reset role;

do $$
begin
  if (select status from public.events where id = 'a6000000-0000-4000-8000-000000000006') <> 'Active' then
    raise exception 'The Draft did not launch.';
  end if;
  if not exists (
    select 1 from public.tasks
    where event_id = 'a6000000-0000-4000-8000-000000000006'
      and title = 'Launch-enabling task'
  ) then
    raise exception 'The task was not added before launch.';
  end if;
end;
$$;

rollback;
```
