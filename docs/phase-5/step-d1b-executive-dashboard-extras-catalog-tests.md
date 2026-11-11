# D1b Executive Dashboard extras catalog test

Run this single paste on **Dev only** in the Supabase SQL Editor with
**Run without RLS**, after the D1b migration and behaviour paste have been
reviewed. It uses an ordinary rollback-only result table and its own
`auth.users`, profile, and committee fixture. It creates no temporary table.

The finished paste has **32 result rows**. Its success sentinel is
`TEST RESULTS 32/32 PASS — transaction intentionally rolled back`.

Every assertion can fail: catalog rows are read from `pg_catalog`, exact OUT
names are taken from `pg_proc`, privilege checks query effective grants, and
the four unchanged D1 definitions are compared with independent expected
sources after carriage returns are stripped from both sides.

```sql
begin;

create table public.d1b_catalog_test_results (
  ordinal integer primary key,
  label text not null unique,
  passed boolean not null,
  detail text not null
);

grant select, insert on public.d1b_catalog_test_results to authenticated;

set local session_replication_role = replica;
insert into public.committees(id, name)
values ('e2000000-0000-4000-8000-000000000001', 'D1b Catalog Fixture');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'e2100000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'd1b-catalog-admin@example.invalid', '',
  pg_catalog.now(), pg_catalog.now(), pg_catalog.now()
);
insert into public.users(id, email, full_name, role, committee_id, is_active)
values (
  'e2100000-0000-4000-8000-000000000001',
  'd1b-catalog-admin@example.invalid', 'D1b Catalog Admin',
  'Admin', null, true
);
set local session_replication_role = origin;

insert into public.d1b_catalog_test_results
select 1, 'ALL_D1B_FUNCTIONS_EXIST', pg_catalog.count(*)=7, pg_catalog.count(*)::text
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where (n.nspname,p.proname) in (
  ('ceit_connect_private','classify_executive_dashboard_task'),
  ('public','get_executive_dashboard_extras_overview'),
  ('public','list_executive_dashboard_needs_attention'),
  ('public','list_executive_dashboard_deadlines'),
  ('public','list_executive_dashboard_free_members'),
  ('public','list_executive_dashboard_member_slipping_signals'),
  ('public','get_executive_dashboard_push_adoption')
);
insert into public.d1b_catalog_test_results
select 2, 'D1B_NO_OVERLOADS', pg_catalog.count(*)=7, pg_catalog.count(*)::text
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where p.proname in (
  'classify_executive_dashboard_task','get_executive_dashboard_extras_overview',
  'list_executive_dashboard_needs_attention','list_executive_dashboard_deadlines',
  'list_executive_dashboard_free_members','list_executive_dashboard_member_slipping_signals',
  'get_executive_dashboard_push_adoption'
);
insert into public.d1b_catalog_test_results
select 3, 'D1B_EXACT_INPUT_SIGNATURES',
  pg_catalog.to_regprocedure('ceit_connect_private.classify_executive_dashboard_task(timestamptz,text,timestamptz)') is not null
  and pg_catalog.to_regprocedure('public.get_executive_dashboard_extras_overview(uuid)') is not null
  and pg_catalog.to_regprocedure('public.list_executive_dashboard_needs_attention(uuid)') is not null
  and pg_catalog.to_regprocedure('public.list_executive_dashboard_deadlines(uuid)') is not null
  and pg_catalog.to_regprocedure('public.list_executive_dashboard_free_members(uuid)') is not null
  and pg_catalog.to_regprocedure('public.list_executive_dashboard_member_slipping_signals(uuid)') is not null
  and pg_catalog.to_regprocedure('public.get_executive_dashboard_push_adoption()') is not null,
  'seven exact identities';
insert into public.d1b_catalog_test_results
select 4, 'D1B_ALL_POSTGRES_OWNED', pg_catalog.bool_and(p.proowner='postgres'::regrole), pg_catalog.count(*)::text
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where (n.nspname,p.proname) in (
  ('ceit_connect_private','classify_executive_dashboard_task'),('public','get_executive_dashboard_extras_overview'),
  ('public','list_executive_dashboard_needs_attention'),('public','list_executive_dashboard_deadlines'),
  ('public','list_executive_dashboard_free_members'),('public','list_executive_dashboard_member_slipping_signals'),
  ('public','get_executive_dashboard_push_adoption')
);
insert into public.d1b_catalog_test_results
select 5, 'D1B_ALL_STABLE', pg_catalog.bool_and(p.provolatile='s'), pg_catalog.count(*)::text
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where (n.nspname,p.proname) in (
  ('ceit_connect_private','classify_executive_dashboard_task'),('public','get_executive_dashboard_extras_overview'),
  ('public','list_executive_dashboard_needs_attention'),('public','list_executive_dashboard_deadlines'),
  ('public','list_executive_dashboard_free_members'),('public','list_executive_dashboard_member_slipping_signals'),
  ('public','get_executive_dashboard_push_adoption')
);
insert into public.d1b_catalog_test_results
select 6, 'D1B_ALL_SECURITY_DEFINER', pg_catalog.bool_and(p.prosecdef), pg_catalog.count(*)::text
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where (n.nspname,p.proname) in (
  ('ceit_connect_private','classify_executive_dashboard_task'),('public','get_executive_dashboard_extras_overview'),
  ('public','list_executive_dashboard_needs_attention'),('public','list_executive_dashboard_deadlines'),
  ('public','list_executive_dashboard_free_members'),('public','list_executive_dashboard_member_slipping_signals'),
  ('public','get_executive_dashboard_push_adoption')
);
insert into public.d1b_catalog_test_results
select 7, 'D1B_ALL_FIXED_EMPTY_PATH', pg_catalog.bool_and(p.proconfig=array['search_path=""']), pg_catalog.count(*)::text
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where (n.nspname,p.proname) in (
  ('ceit_connect_private','classify_executive_dashboard_task'),('public','get_executive_dashboard_extras_overview'),
  ('public','list_executive_dashboard_needs_attention'),('public','list_executive_dashboard_deadlines'),
  ('public','list_executive_dashboard_free_members'),('public','list_executive_dashboard_member_slipping_signals'),
  ('public','get_executive_dashboard_push_adoption')
);
insert into public.d1b_catalog_test_results
select 8, 'CLASSIFIER_NO_APPLICATION_EXECUTE',
  not pg_catalog.has_function_privilege('anon','ceit_connect_private.classify_executive_dashboard_task(timestamptz,text,timestamptz)','EXECUTE')
  and not pg_catalog.has_function_privilege('authenticated','ceit_connect_private.classify_executive_dashboard_task(timestamptz,text,timestamptz)','EXECUTE')
  and not pg_catalog.has_function_privilege('service_role','ceit_connect_private.classify_executive_dashboard_task(timestamptz,text,timestamptz)','EXECUTE')
  and not exists(select 1 from pg_catalog.aclexplode(p.proacl) a where a.grantee=0 and a.privilege_type='EXECUTE'),
  'PUBLIC/anon/authenticated/service_role absent'
from pg_catalog.pg_proc p where p.oid='ceit_connect_private.classify_executive_dashboard_task(timestamptz,text,timestamptz)'::regprocedure;
insert into public.d1b_catalog_test_results
select 9, 'PUBLIC_READERS_AUTHENTICATED_ONLY', pg_catalog.bool_and(
  pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
  and not pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
  and not pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')
  and not exists(select 1 from pg_catalog.aclexplode(p.proacl) a where a.grantee=0 and a.privilege_type='EXECUTE')
), pg_catalog.count(*)::text
from pg_catalog.pg_proc p where p.oid=any(array[
  'public.get_executive_dashboard_extras_overview(uuid)'::regprocedure,
  'public.list_executive_dashboard_needs_attention(uuid)'::regprocedure,
  'public.list_executive_dashboard_deadlines(uuid)'::regprocedure,
  'public.list_executive_dashboard_free_members(uuid)'::regprocedure,
  'public.list_executive_dashboard_member_slipping_signals(uuid)'::regprocedure,
  'public.get_executive_dashboard_push_adoption()'::regprocedure
]);
insert into public.d1b_catalog_test_results
select 10, 'SCOPED_READERS_HAVE_ONE_DEFAULT', pg_catalog.bool_and(p.pronargdefaults=1), pg_catalog.count(*)::text
from pg_catalog.pg_proc p where p.oid=any(array[
  'public.get_executive_dashboard_extras_overview(uuid)'::regprocedure,
  'public.list_executive_dashboard_needs_attention(uuid)'::regprocedure,
  'public.list_executive_dashboard_deadlines(uuid)'::regprocedure,
  'public.list_executive_dashboard_free_members(uuid)'::regprocedure,
  'public.list_executive_dashboard_member_slipping_signals(uuid)'::regprocedure
]);

insert into public.d1b_catalog_test_results
select 11, 'CLASSIFIER_OUTPUT_SHAPE',
  p.proargnames[4:7]=array['out_is_overdue','out_is_due_in_24_hours','out_is_at_risk','out_bucket']
  and p.proallargtypes[4:7]=array['bool'::regtype::oid,'bool'::regtype::oid,'bool'::regtype::oid,'text'::regtype::oid],p.proargnames::text
from pg_catalog.pg_proc p where p.oid='ceit_connect_private.classify_executive_dashboard_task(timestamptz,text,timestamptz)'::regprocedure;
insert into public.d1b_catalog_test_results
select 12, 'OVERVIEW_OUTPUT_SHAPE',p.proargnames[2:12]=array[
  'out_open_task_count','out_overdue_task_count','out_due_in_24_hours_task_count','out_unassigned_task_count','out_help_wanted_task_count','out_needs_approval_count',
  'out_donut_overdue_count','out_donut_due_in_24_hours_count','out_donut_in_progress_count','out_donut_to_do_count','out_donut_completed_count'
] and p.proallargtypes[2:12]=array['int8'::regtype::oid,'int8'::regtype::oid,'int8'::regtype::oid,'int8'::regtype::oid,'int8'::regtype::oid,'int8'::regtype::oid,'int8'::regtype::oid,'int8'::regtype::oid,'int8'::regtype::oid,'int8'::regtype::oid,'int8'::regtype::oid],p.proargnames::text from pg_catalog.pg_proc p where p.oid='public.get_executive_dashboard_extras_overview(uuid)'::regprocedure;
insert into public.d1b_catalog_test_results
select 13, 'ATTENTION_OUTPUT_SHAPE',p.proargnames[2:8]=array[
  'out_category','out_task_id','out_label','out_committee_id','out_committee_name','out_due_date','out_source_created_at'
] and p.proallargtypes[2:8]=array['text'::regtype::oid,'uuid'::regtype::oid,'text'::regtype::oid,'uuid'::regtype::oid,'text'::regtype::oid,'timestamptz'::regtype::oid,'timestamptz'::regtype::oid],p.proargnames::text from pg_catalog.pg_proc p where p.oid='public.list_executive_dashboard_needs_attention(uuid)'::regprocedure;
insert into public.d1b_catalog_test_results
select 14, 'DEADLINES_OUTPUT_SHAPE',p.proargnames[2:3]=array['out_calendar_date','out_open_task_count'] and p.proallargtypes[2:3]=array['date'::regtype::oid,'int8'::regtype::oid],p.proargnames::text
from pg_catalog.pg_proc p where p.oid='public.list_executive_dashboard_deadlines(uuid)'::regprocedure;
insert into public.d1b_catalog_test_results
select 15, 'FREE_MEMBERS_OUTPUT_SHAPE',p.proargnames[2:6]=array['out_member_id','out_full_name','out_avatar_url','out_role','out_open_task_count'] and p.proallargtypes[2:6]=array['uuid'::regtype::oid,'text'::regtype::oid,'text'::regtype::oid,'text'::regtype::oid,'int8'::regtype::oid],p.proargnames::text
from pg_catalog.pg_proc p where p.oid='public.list_executive_dashboard_free_members(uuid)'::regprocedure;
insert into public.d1b_catalog_test_results
select 16, 'SLIPPING_OUTPUT_SHAPE',p.proargnames[2:6]=array['out_committee_id','out_member_id','out_open_task_count','out_overdue_task_count','out_at_risk_task_count'] and p.proallargtypes[2:6]=array['uuid'::regtype::oid,'uuid'::regtype::oid,'int8'::regtype::oid,'int8'::regtype::oid,'int8'::regtype::oid],p.proargnames::text
from pg_catalog.pg_proc p where p.oid='public.list_executive_dashboard_member_slipping_signals(uuid)'::regprocedure;
insert into public.d1b_catalog_test_results
select 17, 'PUSH_OUTPUT_NUMBERS_ONLY',
  p.proargnames=array['out_active_profiles_with_push_count','out_active_profile_count']
  and p.proallargtypes=array['int8'::regtype::oid,'int8'::regtype::oid],p.proargnames::text
from pg_catalog.pg_proc p where p.oid='public.get_executive_dashboard_push_adoption()'::regprocedure;
insert into public.d1b_catalog_test_results
select 18, 'ATTENTION_HAS_NO_PERSON_OUTPUT',not exists(
  select 1 from pg_catalog.unnest(p.proargnames) n(name)
  where n.name in ('out_user_id','out_requester_id','out_volunteer_id','out_full_name','out_avatar_url')
),p.proargnames::text from pg_catalog.pg_proc p where p.oid='public.list_executive_dashboard_needs_attention(uuid)'::regprocedure;
insert into public.d1b_catalog_test_results
select 19, 'CLASSIFIER_HAS_NO_AUTHORIZATION',
  pg_catalog.strpos(p.prosrc,'auth.uid()')=0 and pg_catalog.strpos(pg_catalog.lower(p.prosrc),'access denied')=0,'no auth branch'
from pg_catalog.pg_proc p where p.oid='ceit_connect_private.classify_executive_dashboard_task(timestamptz,text,timestamptz)'::regprocedure;
insert into public.d1b_catalog_test_results
select 20, 'PUBLIC_READERS_AUTHORIZE_BEFORE_AGGREGATION',pg_catalog.bool_and(
  pg_catalog.strpos(p.prosrc,'Executive Dashboard access denied.')>0
  and pg_catalog.strpos(p.prosrc,'Executive Dashboard access denied.')<pg_catalog.strpos(p.prosrc,'return query')
),pg_catalog.count(*)::text from pg_catalog.pg_proc p where p.oid=any(array[
  'public.get_executive_dashboard_extras_overview(uuid)'::regprocedure,'public.list_executive_dashboard_needs_attention(uuid)'::regprocedure,
  'public.list_executive_dashboard_deadlines(uuid)'::regprocedure,'public.list_executive_dashboard_free_members(uuid)'::regprocedure,
  'public.list_executive_dashboard_member_slipping_signals(uuid)'::regprocedure,'public.get_executive_dashboard_push_adoption()'::regprocedure
]);
insert into public.d1b_catalog_test_results
select 21, 'D1B_READERS_TAKE_NO_LOCKS',pg_catalog.bool_and(
  pg_catalog.strpos(pg_catalog.lower(p.prosrc),'for update')=0
  and pg_catalog.strpos(pg_catalog.lower(p.prosrc),'for share')=0
  and pg_catalog.strpos(pg_catalog.lower(p.prosrc),'advisory')=0
),pg_catalog.count(*)::text from pg_catalog.pg_proc p where p.oid=any(array[
  'public.get_executive_dashboard_extras_overview(uuid)'::regprocedure,'public.list_executive_dashboard_needs_attention(uuid)'::regprocedure,
  'public.list_executive_dashboard_deadlines(uuid)'::regprocedure,'public.list_executive_dashboard_free_members(uuid)'::regprocedure,
  'public.list_executive_dashboard_member_slipping_signals(uuid)'::regprocedure,'public.get_executive_dashboard_push_adoption()'::regprocedure
]);
insert into public.d1b_catalog_test_results
select 22, 'D1B_ADDS_NO_RELATION',not exists(
  select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','ceit_connect_private') and c.relname like '%executive_dashboard%' and c.relkind in ('r','p','i','S','v','m')
),'no dashboard relation';
insert into public.d1b_catalog_test_results
select 23, 'D1B_ADDS_NO_FOREIGN_KEY',not exists(
  select 1 from pg_catalog.pg_constraint c where c.contype='f' and c.conname like '%executive_dashboard%'
),'no dashboard FK';

insert into public.d1b_catalog_test_results
select 24, 'D1_PRIVATE_DEFINITION_UNCHANGED',
  pg_catalog.md5(pg_catalog.replace(p.prosrc,chr(13),''))=
  pg_catalog.md5(pg_catalog.replace($expected$
  with active_tasks as materialized (
    select
      task_row.id as task_id,
      array(
        select distinct assignment.assignee_id
        from pg_catalog.unnest(
          task_row.primary_assignees || task_row.assist_assignees
        ) as assignment(assignee_id)
        where assignment.assignee_id is not null
        order by assignment.assignee_id
      ) as assignee_ids
    from public.tasks as task_row
    join public.events as event_row
      on event_row.id = task_row.event_id
     and event_row.status = 'Active'
    where task_row.committee_id = p_committee_id
      and task_row.status <> 'Completed'
  ), classified as materialized (
    select
      active_task.task_id,
      pg_catalog.cardinality(active_task.assignee_ids) = 0 as is_unassigned,
      exists (
        select 1
        from pg_catalog.unnest(active_task.assignee_ids) as assignment(assignee_id)
        join public.users as profile
          on profile.id = assignment.assignee_id
         and profile.is_active is true
      ) as has_active_assignee,
      exists (
        select 1
        from pg_catalog.unnest(active_task.assignee_ids) as assignment(assignee_id)
        join public.users as profile
          on profile.id = assignment.assignee_id
         and profile.is_active is true
         and profile.committee_id = p_committee_id
      ) as has_active_committee_member
    from active_tasks as active_task
  )
  select
    pg_catalog.count(*)::bigint,
    pg_catalog.count(*) filter (
      where classified.has_active_assignee
    )::bigint,
    pg_catalog.count(*) filter (
      where classified.is_unassigned
    )::bigint,
    pg_catalog.count(*) filter (
      where not classified.is_unassigned
        and not classified.has_active_assignee
    )::bigint,
    pg_catalog.count(*) filter (
      where classified.has_active_assignee
        and not classified.has_active_committee_member
    )::bigint,
    pg_catalog.count(*) filter (
      where classified.is_unassigned
         or not classified.has_active_assignee
         or (
           classified.has_active_assignee
           and not classified.has_active_committee_member
         )
    )::bigint
  from classified
$expected$,chr(13),'')), 'normalized private source'
from pg_catalog.pg_proc p where p.oid='ceit_connect_private.executive_dashboard_committee_counts(uuid)'::regprocedure;

insert into public.d1b_catalog_test_results
select 25, 'D1_LEVEL1_DEFINITION_UNCHANGED',
  pg_catalog.md5(pg_catalog.replace(p.prosrc,chr(13),''))=
  pg_catalog.md5(pg_catalog.replace($expected$
declare
  v_caller_role text;
begin
  select profile.role
  into v_caller_role
  from public.users as profile
  where profile.id = auth.uid()
    and profile.is_active is true;

  if not found or v_caller_role <> 'Admin' then
    raise exception using
      errcode = '42501',
      message = 'Executive Dashboard access denied.';
  end if;

  return query
  select
    committee_row.id,
    committee_row.name,
    committee_counts.out_unique_active_task_count,
    committee_counts.out_covered_task_count,
    committee_counts.out_unassigned_task_count,
    committee_counts.out_inactive_only_task_count,
    committee_counts.out_active_outside_committee_only_task_count,
    committee_counts.out_tasks_without_member_bar_count
  from public.committees as committee_row
  cross join lateral
    ceit_connect_private.executive_dashboard_committee_counts(committee_row.id)
      as committee_counts
  order by committee_row.name, committee_row.id;
end;
$expected$,chr(13),'')), 'normalized Level 1 source'
from pg_catalog.pg_proc p where p.oid='public.list_executive_dashboard_committee_totals()'::regprocedure;

insert into public.d1b_catalog_test_results
select 26, 'D1_SUMMARY_DEFINITION_UNCHANGED',
  pg_catalog.md5(pg_catalog.replace(p.prosrc,chr(13),''))=
  pg_catalog.md5(pg_catalog.replace($expected$
declare
  v_caller_role text;
  v_caller_committee_id uuid;
begin
  select profile.role, profile.committee_id
  into v_caller_role, v_caller_committee_id
  from public.users as profile
  where profile.id = auth.uid()
    and profile.is_active is true;

  if not found
     or v_caller_role not in ('Admin', 'Co-Admin')
     or p_committee_id is null
     or not exists (
       select 1
       from public.committees as committee_row
       where committee_row.id = p_committee_id
         and (
           v_caller_role = 'Admin'
           or (
             v_caller_role = 'Co-Admin'
             and v_caller_committee_id = committee_row.id
           )
         )
     ) then
    raise exception using
      errcode = '42501',
      message = 'Executive Dashboard access denied.';
  end if;

  return query
  select
    committee_row.id,
    committee_row.name,
    committee_counts.out_unique_active_task_count,
    committee_counts.out_covered_task_count,
    committee_counts.out_unassigned_task_count,
    committee_counts.out_inactive_only_task_count,
    committee_counts.out_active_outside_committee_only_task_count,
    committee_counts.out_tasks_without_member_bar_count
  from public.committees as committee_row
  cross join lateral
    ceit_connect_private.executive_dashboard_committee_counts(committee_row.id)
      as committee_counts
  where committee_row.id = p_committee_id;
end;
$expected$,chr(13),'')), 'normalized summary source'
from pg_catalog.pg_proc p where p.oid='public.get_executive_dashboard_committee_summary(uuid)'::regprocedure;

insert into public.d1b_catalog_test_results
select 27, 'D1_MEMBERS_DEFINITION_UNCHANGED',
  pg_catalog.md5(pg_catalog.replace(p.prosrc,chr(13),''))=
  pg_catalog.md5(pg_catalog.replace($expected$
declare
  v_caller_role text;
  v_caller_committee_id uuid;
begin
  select profile.role, profile.committee_id
  into v_caller_role, v_caller_committee_id
  from public.users as profile
  where profile.id = auth.uid()
    and profile.is_active is true;

  if not found
     or v_caller_role not in ('Admin', 'Co-Admin')
     or p_committee_id is null
     or not exists (
       select 1
       from public.committees as committee_row
       where committee_row.id = p_committee_id
         and (
           v_caller_role = 'Admin'
           or (
             v_caller_role = 'Co-Admin'
             and v_caller_committee_id = committee_row.id
           )
         )
     ) then
    raise exception using
      errcode = '42501',
      message = 'Executive Dashboard access denied.';
  end if;

  return query
  select
    profile.committee_id,
    profile.id,
    profile.full_name,
    profile.avatar_url,
    pg_catalog.count(distinct task_row.id) filter (
      where event_row.id is not null
    )::bigint
  from public.users as profile
  left join public.tasks as task_row
    on task_row.committee_id = p_committee_id
   and task_row.status <> 'Completed'
   and (
     profile.id = any(task_row.primary_assignees)
     or profile.id = any(task_row.assist_assignees)
   )
  left join public.events as event_row
    on event_row.id = task_row.event_id
   and event_row.status = 'Active'
  where profile.is_active is true
    and profile.committee_id = p_committee_id
  group by profile.committee_id, profile.id, profile.full_name, profile.avatar_url
  order by profile.full_name, profile.id;
end;
$expected$,chr(13),'')), 'normalized members source'
from pg_catalog.pg_proc p where p.oid='public.list_executive_dashboard_committee_members(uuid)'::regprocedure;

insert into public.d1b_catalog_test_results
select 28, 'D1_EXACT_IDENTITIES_AND_NO_OVERLOADS',pg_catalog.count(*)=4,pg_catalog.count(*)::text
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where (n.nspname,p.proname) in (
  ('ceit_connect_private','executive_dashboard_committee_counts'),
  ('public','list_executive_dashboard_committee_totals'),
  ('public','get_executive_dashboard_committee_summary'),
  ('public','list_executive_dashboard_committee_members')
);
insert into public.d1b_catalog_test_results
select 29, 'D1_OUTPUT_SHAPES_UNCHANGED',
  h.proargnames[2:7]=array['out_unique_active_task_count','out_covered_task_count','out_unassigned_task_count','out_inactive_only_task_count','out_active_outside_committee_only_task_count','out_tasks_without_member_bar_count']
  and l.proargnames=array['out_committee_id','out_committee_name','out_unique_active_task_count','out_covered_task_count','out_unassigned_task_count','out_inactive_only_task_count','out_active_outside_committee_only_task_count','out_tasks_without_member_bar_count']
  and s.proargnames[2:9]=array['out_committee_id','out_committee_name','out_unique_active_task_count','out_covered_task_count','out_unassigned_task_count','out_inactive_only_task_count','out_active_outside_committee_only_task_count','out_tasks_without_member_bar_count']
  and m.proargnames[2:6]=array['out_committee_id','out_member_id','out_full_name','out_avatar_url','out_active_task_count'],
  'four exact pg_proc OUT arrays'
from pg_catalog.pg_proc h, pg_catalog.pg_proc l, pg_catalog.pg_proc s, pg_catalog.pg_proc m
where h.oid='ceit_connect_private.executive_dashboard_committee_counts(uuid)'::regprocedure
  and l.oid='public.list_executive_dashboard_committee_totals()'::regprocedure
  and s.oid='public.get_executive_dashboard_committee_summary(uuid)'::regprocedure
  and m.oid='public.list_executive_dashboard_committee_members(uuid)'::regprocedure;
insert into public.d1b_catalog_test_results
select 30, 'D1_PROPERTIES_AND_GRANTS_UNCHANGED',pg_catalog.bool_and(
  p.proowner='postgres'::regrole and p.provolatile='s' and p.prosecdef and p.proconfig=array['search_path=""']
  and not pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
  and not pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')
  and (
    (p.oid='ceit_connect_private.executive_dashboard_committee_counts(uuid)'::regprocedure and not pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE'))
    or (p.oid<>'ceit_connect_private.executive_dashboard_committee_counts(uuid)'::regprocedure and pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE'))
  )
),pg_catalog.count(*)::text from pg_catalog.pg_proc p where p.oid=any(array[
  'ceit_connect_private.executive_dashboard_committee_counts(uuid)'::regprocedure,'public.list_executive_dashboard_committee_totals()'::regprocedure,
  'public.get_executive_dashboard_committee_summary(uuid)'::regprocedure,'public.list_executive_dashboard_committee_members(uuid)'::regprocedure
]);

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','e2100000-0000-4000-8000-000000000001',true);
insert into public.d1b_catalog_test_results
select 31, 'AUTHENTICATED_FIXTURE_CALLS_PUBLIC_READER',
  x.out_open_task_count=0 and x.out_donut_completed_count=0,x::text
from public.get_executive_dashboard_extras_overview('e2000000-0000-4000-8000-000000000001') x;
reset role;
insert into public.d1b_catalog_test_results
select 32, 'CLASSIFIER_ALLOWED_BUCKET_TEXT_PINNED',
  pg_catalog.strpos(p.prosrc,'''Overdue''')>0
  and pg_catalog.strpos(p.prosrc,'''Due in 24 hours''')>0
  and pg_catalog.strpos(p.prosrc,'''In Progress''')>0
  and pg_catalog.strpos(p.prosrc,'''To Do''')>0
  and pg_catalog.strpos(p.prosrc,'''Completed''')>0,
  'five allowed labels present'
from pg_catalog.pg_proc p where p.oid='ceit_connect_private.classify_executive_dashboard_task(timestamptz,text,timestamptz)'::regprocedure;

select ordinal, label, passed, detail
from public.d1b_catalog_test_results
order by ordinal;

do $$
declare
  v_total integer;
  v_passed integer;
begin
  select pg_catalog.count(*)::integer,
         pg_catalog.count(*) filter (where result.passed)::integer
  into v_total, v_passed
  from public.d1b_catalog_test_results as result;

  if v_total=32 and v_passed=32 then
    raise exception 'TEST RESULTS 32/32 PASS — transaction intentionally rolled back';
  end if;
  raise exception 'TEST RESULTS %/32 PASS — transaction intentionally rolled back',v_passed;
end
$$;
```
