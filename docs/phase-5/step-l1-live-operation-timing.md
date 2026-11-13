# L1 — Live Operation timing rules

Branch: `feature/live-operation-call-time-rules`

## Outcome

Deliverables retain their exact due-date comparisons. Live Operations use START = `call_time`, else `due_date`; END = `end_time`, else `call_time`, else `due_date`. Running requires both call and end times and uses the half-open interval `call_time <= as_of < end_time`.

The sole permanent timing helper is `ceit_connect_private.task_timing_reference(...)`. It has an empty search path and no PUBLIC, anon, authenticated, or service-role execute privilege. The migration has no `session_user` requirement, so it is compatible with the Supabase CLI temporary login role. No app code changed, so there is no app-first deploy order.

## Replacement review

| Latest function | Old | New | Preserved |
|---|---|---|---|
| `calculate_effective_task_priority` (`20261016140000`, 48 lines) | Four arguments; due-only | Seven arguments; helper START/END/running | Validation text and stored-priority rules |
| `list_event_board_tasks_pre13c` (`20261021130000`, 166 lines) | Passes priority/due/status | Also passes type/call/end | Shape, masking, order, grants |
| `list_event_board_tasks_pre13b_ui` (`20261030130000`, 74 lines) | Draft priority uses due | Draft priority uses full timing | Active delegation and shape |
| `get_task_detail_pre13b_ui` (`20261028120000`, 253 lines) | Due-only priority | Full timing priority | Confidential masking and stored due output |
| `list_my_tasks` (`20261022150000`, 133 lines) | Due-only priority | Full timing priority | Filters, errors, stored-due sorting/output |
| `list_help_wanted_tasks` (`20261022120000`, 77 lines) | Due-only priority | Full timing priority | Stored-due output and sorting |
| `get_task_edit_controls_pre13c` (`20261028120000`, 275 lines) | 72h hint uses due | 72h hint uses START | Shape and `due` block code |
| `unassign_self_step12` (`20261027120000`, 224 lines) | Inner `clock_timestamp()` cutoff uses due | Same clock and 72h interval use START | Lock order, errors, writer marker |
| `unassign_self` (`20261029150000`, 30 lines) | Outer `statement_timestamp()` cutoff uses due | Same clock and 72h interval use START | Officer path and leave requests |
| private dashboard classifier (`20261114120000`, 47 lines) | Due-only, three arguments | Full timing, six arguments | Exact Deliverable comparisons and buckets |
| dashboard overview (`20261114120000`, 182 lines) | Due-only classifier | Full timing classifier | Public counts and authorization |
| dashboard attention (`20261114120000`, 215 lines) | Shows/sorts stored due | END for overdue; START otherwise | Shape, masking, 20-row cap |
| dashboard deadlines (`20261114120000`, 74 lines) | Manila due-date grouping | Manila START grouping | Seven-row shape and scope |
| dashboard slipping signals (`20261114120000`, 114 lines) | Due-only classifier | Full timing classifier | Member scope and return shape |

The migration-time rewrite helper requires every old source fragment exactly once and is dropped before completion. This preserves the latest large bodies outside the reviewed substitutions. The old four-argument priority function and old three-argument classifier are dropped after all callers move.

## UI and deferred behavior

`list_executive_dashboard_needs_attention.out_due_date` keeps its name/type. The existing screen formats it in Manila time after category and committee; no label changes. The weekly deadline chart groups START without a shape or label change.

Board cards, task detail, and My Tasks intentionally continue showing stored `due_date`; correcting those displays is deferred. Help Wanted also keeps stored-due display and sorting. R2 intentionally continues using stored `due_date` for its 24-hour reminder.

## Rollout

The owner first runs `npx supabase db push --dry-run` and reviews the pending migration. If the dry-run is correct, apply it with `npx supabase db push`. Never paste the migration into the SQL Editor. Only the two test pastes below go into the Dev SQL Editor.

## Tests

- Catalog paste: `step-l1-live-operation-timing-catalog-tests.md` — 14 result lines.
- Behaviour paste: `step-l1-live-operation-timing-behaviour-tests.md` — 39 result lines.
- Both are Dev-only, Run-without-RLS, self-contained transactions ending in an intentional rollback exception.

## Local verification

- `npx.cmd tsc --noEmit`: only the existing missing Next-generated `PageProps`/`LayoutProps` globals in three files.
- `npm.cmd run test`: 1,359 pass; three unrelated J1 CRLF-sensitive assertions fail.
- `npm.cmd run lint`: zero errors; one existing unused `INK` warning in `mascot.tsx`.
- `git diff --check`: pass.

## Full migration SQL

```sql
-- Phase 5 L1: make Live Operation timing rules use call/end references.
-- No table, column, policy, trigger, or application-visible return shape changes.

create function ceit_connect_private.task_timing_reference(
  p_task_type text,
  p_due_date timestamptz,
  p_call_time timestamptz,
  p_end_time timestamptz,
  p_status text,
  p_as_of timestamptz
)
returns table (
  out_start timestamptz,
  out_end timestamptz,
  out_is_running boolean
)
language plpgsql
immutable
security definer
set search_path = ''
as $$
begin
  if p_task_type is null or p_task_type not in ('Deliverable', 'LiveOperation')
     or p_status is null or p_status not in ('To Do', 'In Progress', 'Completed')
     or p_as_of is null then
    raise exception using
      errcode = '22023',
      message = 'Task timing inputs are invalid.';
  end if;

  if p_task_type = 'Deliverable' then
    out_start := p_due_date;
    out_end := p_due_date;
    out_is_running := false;
  else
    out_start := coalesce(p_call_time, p_due_date);
    out_end := coalesce(p_end_time, p_call_time, p_due_date);
    out_is_running := p_status <> 'Completed'
      and p_call_time is not null
      and p_end_time is not null
      and p_call_time <= p_as_of
      and p_as_of < p_end_time;
  end if;

  return next;
end;
$$;

alter function ceit_connect_private.task_timing_reference(
  text, timestamptz, timestamptz, timestamptz, text, timestamptz
) owner to postgres;
revoke all on function ceit_connect_private.task_timing_reference(
  text, timestamptz, timestamptz, timestamptz, text, timestamptz
) from public, anon, authenticated, service_role;

create function public.calculate_effective_task_priority(
  p_priority text,
  p_task_type text,
  p_due_date timestamptz,
  p_call_time timestamptz,
  p_end_time timestamptz,
  p_as_of timestamptz,
  p_status text
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_timing record;
begin
  if p_priority is null
     or p_priority not in ('Low', 'Medium', 'High', 'Critical') then
    raise exception using
      errcode = '22023',
      message = 'Task priority must be Low, Medium, High, or Critical.';
  end if;

  if p_as_of is null then
    raise exception using
      errcode = '22023',
      message = 'Priority calculation timestamp is required.';
  end if;

  if p_status is null
     or p_status not in ('To Do', 'In Progress', 'Completed') then
    raise exception using
      errcode = '22023',
      message = 'Task status must be To Do, In Progress, or Completed.';
  end if;

  if p_status = 'Completed' then
    return p_priority;
  end if;

  select timing_row.* into v_timing
  from ceit_connect_private.task_timing_reference(
    p_task_type, p_due_date, p_call_time, p_end_time, p_status, p_as_of
  ) as timing_row;

  if v_timing.out_end < p_as_of then
    return 'Critical';
  end if;

  if (v_timing.out_is_running
      or (
        v_timing.out_start >= p_as_of
        and v_timing.out_start <= p_as_of + interval '24 hours'
      ))
     and p_priority in ('Low', 'Medium') then
    return 'High';
  end if;

  return p_priority;
end;
$$;

alter function public.calculate_effective_task_priority(
  text, text, timestamptz, timestamptz, timestamptz, timestamptz, text
) owner to postgres;
revoke all on function public.calculate_effective_task_priority(
  text, text, timestamptz, timestamptz, timestamptz, timestamptz, text
) from public, anon, authenticated, service_role;

-- Migration-only guarded source transformer.  Each replacement must occur
-- exactly once; it is dropped before the migration completes.
create function ceit_connect_private.l1_rewrite_function(
  p_function regprocedure,
  p_old text[],
  p_new text[]
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_definition text;
  v_index integer;
begin
  if pg_catalog.cardinality(p_old) is distinct from pg_catalog.cardinality(p_new)
     or pg_catalog.cardinality(p_old) is null then
    raise exception 'L1 rewrite arrays are invalid for %.', p_function;
  end if;

  select pg_catalog.pg_get_functiondef(p_function::oid) into v_definition;
  v_definition := pg_catalog.replace(
    v_definition,
    pg_catalog.chr(13),
    ''
  );
  for v_index in 1..pg_catalog.cardinality(p_old) loop
    if p_old[v_index] = ''
       or pg_catalog.strpos(v_definition, p_old[v_index]) = 0
       or pg_catalog.strpos(
         pg_catalog.substr(
           v_definition,
           pg_catalog.strpos(v_definition, p_old[v_index])
             + pg_catalog.length(p_old[v_index])
         ),
         p_old[v_index]
       ) > 0 then
      raise exception 'L1 rewrite fragment % did not occur exactly once in %.',
        v_index, p_function;
    end if;
    v_definition := pg_catalog.replace(v_definition, p_old[v_index], p_new[v_index]);
  end loop;
  execute v_definition;
end;
$$;
alter function ceit_connect_private.l1_rewrite_function(
  regprocedure, text[], text[]
) owner to postgres;
revoke all on function ceit_connect_private.l1_rewrite_function(
  regprocedure, text[], text[]
) from public, anon, authenticated, service_role;

-- Active-event board implementation.
select ceit_connect_private.l1_rewrite_function(
  'public.list_event_board_tasks_pre13c(uuid,uuid)'::regprocedure,
  array[
    $l1$      task_row.priority,
      task_row.due_date,$l1$,
    $l1$          bt.priority,
          bt.due_date,
          v_as_of,
          bt.status$l1$
  ],
  array[
    $l1$      task_row.priority,
      task_row.task_type,
      task_row.due_date,
      task_row.call_time,
      task_row.end_time,$l1$,
    $l1$          bt.priority,
          bt.task_type,
          bt.due_date,
          bt.call_time,
          bt.end_time,
          v_as_of,
          bt.status$l1$
  ]
);

-- Draft/Active board compatibility implementation.
select ceit_connect_private.l1_rewrite_function(
  'public.list_event_board_tasks_pre13b_ui(uuid,uuid)'::regprocedure,
  array[
    $l1$      editor_row.out_priority, editor_row.out_due_date,
      pg_catalog.statement_timestamp(), editor_row.out_status$l1$
  ],
  array[
    $l1$      editor_row.out_priority, editor_row.out_task_type,
      editor_row.out_due_date, editor_row.out_call_time, editor_row.out_end_time,
      pg_catalog.statement_timestamp(), editor_row.out_status$l1$
  ]
);

-- Innermost detail reader; later wrappers remain unchanged.
select ceit_connect_private.l1_rewrite_function(
  'public.get_task_detail_pre13b_ui(uuid)'::regprocedure,
  array[
    $l1$      dr.priority,
      dr.due_date,
      v_as_of,
      dr.status$l1$
  ],
  array[
    $l1$      dr.priority,
      dr.task_type,
      dr.due_date,
      dr.call_time,
      dr.end_time,
      v_as_of,
      dr.status$l1$
  ]
);

select ceit_connect_private.l1_rewrite_function(
  'public.list_my_tasks(text,text,integer,integer)'::regprocedure,
  array[
    $l1$        task_row.priority,
        task_row.due_date,
        v_as_of,
        task_row.status$l1$
  ],
  array[
    $l1$        task_row.priority,
        task_row.task_type,
        task_row.due_date,
        task_row.call_time,
        task_row.end_time,
        v_as_of,
        task_row.status$l1$
  ]
);

select ceit_connect_private.l1_rewrite_function(
  'public.list_help_wanted_tasks(integer,integer)'::regprocedure,
  array[
    $l1$      task_row.priority,
      task_row.due_date,
      statement_timestamp(),
      task_row.status$l1$
  ],
  array[
    $l1$      task_row.priority,
      task_row.task_type,
      task_row.due_date,
      task_row.call_time,
      task_row.end_time,
      statement_timestamp(),
      task_row.status$l1$
  ]
);

-- The innermost edit-control reader owns the 72-hour hint decision.
select ceit_connect_private.l1_rewrite_function(
  'public.get_task_edit_controls_pre13c(uuid)'::regprocedure,
  array[
    $l1$  v_task_due_date timestamptz;
  v_task_dependency_id uuid;$l1$,
    $l1$    task_row.due_date,
    task_row.depends_on_task_id,$l1$,
    $l1$    v_task_due_date,
    v_task_dependency_id,$l1$,
    $l1$  v_self_unassign_block_code := case
    when not v_is_self_assigned or v_task_event_status <> 'Active' then null
    when v_task_status = 'Completed' then 'completed'
    when v_task_due_date is not null
         and v_task_due_date <= statement_timestamp() + c_self_unassign_cutoff
      then 'due'
    else null
  end;$l1$
  ],
  array[
    $l1$  v_task_type text;
  v_task_due_date timestamptz;
  v_task_call_time timestamptz;
  v_task_end_time timestamptz;
  v_task_start timestamptz;
  v_task_dependency_id uuid;$l1$,
    $l1$    task_row.task_type,
    task_row.due_date,
    task_row.call_time,
    task_row.end_time,
    task_row.depends_on_task_id,$l1$,
    $l1$    v_task_type,
    v_task_due_date,
    v_task_call_time,
    v_task_end_time,
    v_task_dependency_id,$l1$,
    $l1$  select timing_row.out_start into v_task_start
  from ceit_connect_private.task_timing_reference(
    v_task_type, v_task_due_date, v_task_call_time, v_task_end_time,
    v_task_status, statement_timestamp()
  ) as timing_row;

  v_self_unassign_block_code := case
    when not v_is_self_assigned or v_task_event_status <> 'Active' then null
    when v_task_status = 'Completed' then 'completed'
    when v_task_start is not null
         and v_task_start <= statement_timestamp() + c_self_unassign_cutoff
      then 'due'
    else null
  end;$l1$
  ]
);

-- Outer leave/request boundary: keep statement_timestamp().
select ceit_connect_private.l1_rewrite_function(
  'public.unassign_self(uuid)'::regprocedure,
  array[
    $l1$declare v_id uuid:=auth.uid(); v_role text; v_due timestamptz; v_status text;$l1$,
    $l1$  select due_date,status,primary_assignees,assist_assignees into v_due,v_status,v_primary,v_assist from public.tasks where id=p_task_id and event_id=v_event for update;$l1$,
    $l1$  if v_due is null or v_due>statement_timestamp()+interval '72 hours' then$l1$
  ],
  array[
    $l1$declare v_id uuid:=auth.uid(); v_role text; v_type text; v_due timestamptz; v_call timestamptz; v_end timestamptz; v_start timestamptz; v_status text;$l1$,
    $l1$  select task_type,due_date,call_time,end_time,status,primary_assignees,assist_assignees into v_type,v_due,v_call,v_end,v_status,v_primary,v_assist from public.tasks where id=p_task_id and event_id=v_event for update;$l1$,
    $l1$  select timing_row.out_start into v_start from ceit_connect_private.task_timing_reference(v_type,v_due,v_call,v_end,v_status,statement_timestamp()) as timing_row;
  if v_start is null or v_start>statement_timestamp()+interval '72 hours' then$l1$
  ]
);

-- Inner physical unassign: keep its existing clock_timestamp() source.
select ceit_connect_private.l1_rewrite_function(
  'public.unassign_self_step12(uuid)'::regprocedure,
  array[
    $l1$  v_task_due_date timestamptz;
  v_stored_primary_assignees uuid[];$l1$,
    $l1$    task_row.sort_order,
    task_row.due_date,
    task_row.primary_assignees,$l1$,
    $l1$    v_task_sort_order,
    v_task_due_date,
    v_stored_primary_assignees,$l1$,
    $l1$  if v_task_due_date is not null
     and v_task_due_date <= pg_catalog.clock_timestamp() + c_self_unassign_cutoff then$l1$
  ],
  array[
    $l1$  v_task_type text;
  v_task_due_date timestamptz;
  v_task_call_time timestamptz;
  v_task_end_time timestamptz;
  v_task_start timestamptz;
  v_stored_primary_assignees uuid[];$l1$,
    $l1$    task_row.sort_order,
    task_row.task_type,
    task_row.due_date,
    task_row.call_time,
    task_row.end_time,
    task_row.primary_assignees,$l1$,
    $l1$    v_task_sort_order,
    v_task_type,
    v_task_due_date,
    v_task_call_time,
    v_task_end_time,
    v_stored_primary_assignees,$l1$,
    $l1$  select timing_row.out_start into v_task_start
  from ceit_connect_private.task_timing_reference(
    v_task_type, v_task_due_date, v_task_call_time, v_task_end_time,
    v_task_status, pg_catalog.clock_timestamp()
  ) as timing_row;

  if v_task_start is not null
     and v_task_start <= pg_catalog.clock_timestamp() + c_self_unassign_cutoff then$l1$
  ]
);

create function ceit_connect_private.classify_executive_dashboard_task(
  p_task_type text,
  p_due_date timestamptz,
  p_call_time timestamptz,
  p_end_time timestamptz,
  p_status text,
  p_as_of timestamptz
)
returns table (
  out_is_overdue boolean,
  out_is_due_in_24_hours boolean,
  out_is_at_risk boolean,
  out_bucket text,
  out_start timestamptz,
  out_end timestamptz,
  out_is_running boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_as_of is null
     or p_status is null
     or p_status not in ('To Do', 'In Progress', 'Completed') then
    raise exception using
      errcode = '22023',
      message = 'Task classification inputs are invalid.';
  end if;

  select timing_row.*
  into out_start, out_end, out_is_running
  from ceit_connect_private.task_timing_reference(
    p_task_type, p_due_date, p_call_time, p_end_time, p_status, p_as_of
  ) as timing_row;

  out_is_overdue := p_status <> 'Completed'
    and not out_is_running
    and out_end is not null
    and out_end < p_as_of;
  out_is_due_in_24_hours := p_status <> 'Completed'
    and not out_is_running
    and out_start is not null
    and out_start >= p_as_of
    and out_start <= p_as_of + interval '24 hours';
  out_is_at_risk := p_status = 'To Do'
    and not out_is_running
    and out_start is not null
    and out_start > p_as_of + interval '24 hours'
    and out_start <= p_as_of + interval '48 hours';
  out_bucket := case
    when p_status = 'Completed' then 'Completed'
    when out_is_overdue then 'Overdue'
    when out_is_due_in_24_hours then 'Due in 24 hours'
    when p_status = 'In Progress' then 'In Progress'
    else 'To Do'
  end;

  return next;
end;
$$;
alter function ceit_connect_private.classify_executive_dashboard_task(
  text, timestamptz, timestamptz, timestamptz, text, timestamptz
) owner to postgres;
revoke all on function ceit_connect_private.classify_executive_dashboard_task(
  text, timestamptz, timestamptz, timestamptz, text, timestamptz
) from public, anon, authenticated, service_role;

select ceit_connect_private.l1_rewrite_function(
  'public.get_executive_dashboard_extras_overview(uuid)'::regprocedure,
  array[
    $l1$      task_row.status,
      task_row.due_date,$l1$,
    $l1$      scoped_task.due_date,
      scoped_task.status,
      v_as_of$l1$
  ],
  array[
    $l1$      task_row.status,
      task_row.task_type,
      task_row.due_date,
      task_row.call_time,
      task_row.end_time,$l1$,
    $l1$      scoped_task.task_type,
      scoped_task.due_date,
      scoped_task.call_time,
      scoped_task.end_time,
      scoped_task.status,
      v_as_of$l1$
  ]
);

select ceit_connect_private.l1_rewrite_function(
  'public.list_executive_dashboard_needs_attention(uuid)'::regprocedure,
  array[
    $l1$      task_row.status,
      task_row.due_date,$l1$,
    $l1$      classification.out_is_overdue,
      classification.out_is_due_in_24_hours$l1$,
    $l1$      scoped_task.due_date,
      scoped_task.status,
      v_as_of$l1$,
    $l1$      classified.due_date,
      classified.created_at as source_created_at,$l1$,
    $l1$    join scoped_tasks as scoped_task
      on scoped_task.id = leave_request.task_id$l1$,
    $l1$      scoped_task.due_date,
      leave_request.created_at as source_created_at,$l1$,
    $l1$    join scoped_tasks as scoped_task
      on scoped_task.id = volunteer_offer.task_id$l1$,
    $l1$      scoped_task.due_date,
      volunteer_offer.created_at,$l1$
  ],
  array[
    $l1$      task_row.status,
      task_row.task_type,
      task_row.due_date,
      task_row.call_time,
      task_row.end_time,$l1$,
    $l1$      classification.out_is_overdue,
      classification.out_is_due_in_24_hours,
      classification.out_start,
      classification.out_end$l1$,
    $l1$      scoped_task.task_type,
      scoped_task.due_date,
      scoped_task.call_time,
      scoped_task.end_time,
      scoped_task.status,
      v_as_of$l1$,
    $l1$      case when classified.out_is_overdue
        then classified.out_end else classified.out_start end as due_date,
      classified.created_at as source_created_at,$l1$,
    $l1$    join classified as scoped_task
      on scoped_task.id = leave_request.task_id$l1$,
    $l1$      scoped_task.out_start,
      leave_request.created_at as source_created_at,$l1$,
    $l1$    join classified as scoped_task
      on scoped_task.id = volunteer_offer.task_id$l1$,
    $l1$      scoped_task.out_start,
      volunteer_offer.created_at,$l1$
  ]
);

select ceit_connect_private.l1_rewrite_function(
  'public.list_executive_dashboard_deadlines(uuid)'::regprocedure,
  array[
    $l1$      (task_row.due_date at time zone 'Asia/Manila')::date as calendar_date,$l1$,
    $l1$    where task_row.status <> 'Completed'
      and task_row.due_date is not null$l1$,
    $l1$      and (task_row.due_date at time zone 'Asia/Manila')::date
        between v_today and v_today + 6
    group by (task_row.due_date at time zone 'Asia/Manila')::date$l1$
  ],
  array[
    $l1$      (timing_row.out_start at time zone 'Asia/Manila')::date as calendar_date,$l1$,
    $l1$    cross join lateral ceit_connect_private.task_timing_reference(
      task_row.task_type, task_row.due_date, task_row.call_time, task_row.end_time,
      task_row.status, statement_timestamp()
    ) as timing_row
    where task_row.status <> 'Completed'
      and timing_row.out_start is not null$l1$,
    $l1$      and (timing_row.out_start at time zone 'Asia/Manila')::date
        between v_today and v_today + 6
    group by (timing_row.out_start at time zone 'Asia/Manila')::date$l1$
  ]
);

select ceit_connect_private.l1_rewrite_function(
  'public.list_executive_dashboard_member_slipping_signals(uuid)'::regprocedure,
  array[
    $l1$      task_row.due_date,
      task_row.status,
      v_as_of$l1$
  ],
  array[
    $l1$      task_row.task_type,
      task_row.due_date,
      task_row.call_time,
      task_row.end_time,
      task_row.status,
      v_as_of$l1$
  ]
);

-- All callers now use the new signatures; leave no compatibility overloads.
drop function public.calculate_effective_task_priority(
  text, timestamptz, timestamptz, text
);
drop function ceit_connect_private.classify_executive_dashboard_task(
  timestamptz, text, timestamptz
);
drop function ceit_connect_private.l1_rewrite_function(
  regprocedure, text[], text[]
);
```

