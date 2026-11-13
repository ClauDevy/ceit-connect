# L1 live-operation timing — catalog test

Dev only. Apply `20261119120000_live_operation_timing_rules.sql`, open the Dev
SQL Editor, turn **Run without RLS** on, and run this entire block as one paste.
The final exception is intentional and rolls the fixtures back.

```sql
begin;

create table public.l1_catalog_results(
  n integer primary key,
  label text not null,
  passed boolean not null
);

-- These internal checks intentionally run as postgres before any role/JWT
-- impersonation lines. Application roles are checked through the catalog.
insert into public.l1_catalog_results values
(1,'timing helper exact signature',pg_catalog.to_regprocedure('ceit_connect_private.task_timing_reference(text,timestamptz,timestamptz,timestamptz,text,timestamptz)') is not null),
(2,'old priority signature absent',pg_catalog.to_regprocedure('public.calculate_effective_task_priority(text,timestamptz,timestamptz,text)') is null),
(3,'new priority signature present',pg_catalog.to_regprocedure('public.calculate_effective_task_priority(text,text,timestamptz,timestamptz,timestamptz,timestamptz,text)') is not null),
(4,'old classifier signature absent',pg_catalog.to_regprocedure('ceit_connect_private.classify_executive_dashboard_task(timestamptz,text,timestamptz)') is null),
(5,'new classifier signature present',pg_catalog.to_regprocedure('ceit_connect_private.classify_executive_dashboard_task(text,timestamptz,timestamptz,timestamptz,text,timestamptz)') is not null),
(6,'migration rewrite helper removed',pg_catalog.to_regprocedure('ceit_connect_private.l1_rewrite_function(regprocedure,text[],text[])') is null);

insert into public.l1_catalog_results
select 7,'helper owner security volatility path',
  pg_catalog.pg_get_userbyid(p.proowner)='postgres'
  and p.prosecdef
  and p.provolatile='i'
  and p.proconfig=array['search_path=""']
from pg_catalog.pg_proc p
where p.oid='ceit_connect_private.task_timing_reference(text,timestamptz,timestamptz,timestamptz,text,timestamptz)'::regprocedure;

insert into public.l1_catalog_results
select 8,'helper denied to anon authenticated service role',
  not pg_catalog.has_function_privilege('anon',p.oid,'execute')
  and not pg_catalog.has_function_privilege('authenticated',p.oid,'execute')
  and not pg_catalog.has_function_privilege('service_role',p.oid,'execute')
from pg_catalog.pg_proc p
where p.oid='ceit_connect_private.task_timing_reference(text,timestamptz,timestamptz,timestamptz,text,timestamptz)'::regprocedure;

insert into public.l1_catalog_results
select 9,'priority helper denied to application roles',
  not pg_catalog.has_function_privilege('anon',p.oid,'execute')
  and not pg_catalog.has_function_privilege('authenticated',p.oid,'execute')
  and not pg_catalog.has_function_privilege('service_role',p.oid,'execute')
from pg_catalog.pg_proc p
where p.oid='public.calculate_effective_task_priority(text,text,timestamptz,timestamptz,timestamptz,timestamptz,text)'::regprocedure;

insert into public.l1_catalog_results
select 10,'classifier denied to application roles',
  not pg_catalog.has_function_privilege('anon',p.oid,'execute')
  and not pg_catalog.has_function_privilege('authenticated',p.oid,'execute')
  and not pg_catalog.has_function_privilege('service_role',p.oid,'execute')
from pg_catalog.pg_proc p
where p.oid='ceit_connect_private.classify_executive_dashboard_task(text,timestamptz,timestamptz,timestamptz,text,timestamptz)'::regprocedure;

insert into public.l1_catalog_results
select 11,'all replaced functions remain postgres owned',
  pg_catalog.count(*)=14 and pg_catalog.bool_and(pg_catalog.pg_get_userbyid(p.proowner)='postgres')
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace nsp on nsp.oid=p.pronamespace
where (nsp.nspname,p.proname) in (
  ('public','calculate_effective_task_priority'),
  ('public','list_event_board_tasks_pre13c'),
  ('public','list_event_board_tasks_pre13b_ui'),
  ('public','get_task_detail_pre13b_ui'),
  ('public','list_my_tasks'),('public','list_help_wanted_tasks'),
  ('public','get_task_edit_controls_pre13c'),
  ('public','unassign_self_step12'),('public','unassign_self'),
  ('ceit_connect_private','classify_executive_dashboard_task'),
  ('public','get_executive_dashboard_extras_overview'),
  ('public','list_executive_dashboard_needs_attention'),
  ('public','list_executive_dashboard_deadlines'),
  ('public','list_executive_dashboard_member_slipping_signals')
);

insert into public.l1_catalog_results
select 12,'public reader and writer grants preserved',
  pg_catalog.bool_and(pg_catalog.has_function_privilege('authenticated',p.oid,'execute'))
  and pg_catalog.bool_and(not pg_catalog.has_function_privilege('anon',p.oid,'execute'))
from pg_catalog.pg_proc p
where p.oid=any(array[
  'public.list_my_tasks(text,text,integer,integer)'::regprocedure,
  'public.list_help_wanted_tasks(integer,integer)'::regprocedure,
  'public.unassign_self(uuid)'::regprocedure,
  'public.get_executive_dashboard_extras_overview(uuid)'::regprocedure,
  'public.list_executive_dashboard_needs_attention(uuid)'::regprocedure,
  'public.list_executive_dashboard_deadlines(uuid)'::regprocedure,
  'public.list_executive_dashboard_member_slipping_signals(uuid)'::regprocedure
]);

-- Scan every SQL/PLpgSQL invocation in both schemas. Count the arguments of
-- each call itself: timing tokens elsewhere in a body cannot mask an old call.
with negative_fixture(body) as (
  values ($l1$begin
  perform public.calculate_effective_task_priority(
    p_priority, coalesce(p_due_date, p_call_time), p_as_of, p_status
  );
  perform p_task_type || task_type || call_time::text || end_time::text;
end;$l1$)
)
insert into public.l1_catalog_results
select 13,'no old priority invocation; timing-token fixture is detected',not exists(
  select 1
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  cross join lateral (select pg_catalog.pg_get_functiondef(p.oid) as body) d
  cross join lateral pg_catalog.regexp_matches(
    d.body,
    'calculate_effective_task_priority[[:space:]]*\(([^(),]|\([^()]*\))*[,]([^(),]|\([^()]*\))*[,]([^(),]|\([^()]*\))*[,]([^(),]|\([^()]*\))*\)',
    'g'
  ) as invocation(arguments)
  where n.nspname in ('public','ceit_connect_private')
    and p.prokind='f'
)
and exists(
  select 1
  from negative_fixture
  cross join lateral pg_catalog.regexp_matches(
    negative_fixture.body,
    'calculate_effective_task_priority[[:space:]]*\(([^(),]|\([^()]*\))*[,]([^(),]|\([^()]*\))*[,]([^(),]|\([^()]*\))*[,]([^(),]|\([^()]*\))*\)',
    'g'
  ) as invocation(arguments)
);

with negative_fixture(body) as (
  values ($l1$begin
  perform ceit_connect_private.classify_executive_dashboard_task(
    coalesce(p_due_date, p_call_time), p_status, p_as_of
  );
  perform p_task_type || task_type || call_time::text || end_time::text;
end;$l1$)
)
insert into public.l1_catalog_results
select 14,'no old classifier invocation; timing-token fixture is detected',not exists(
  select 1
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  cross join lateral (select pg_catalog.pg_get_functiondef(p.oid) as body) d
  cross join lateral pg_catalog.regexp_matches(
    d.body,
    'classify_executive_dashboard_task[[:space:]]*\(([^(),]|\([^()]*\))*[,]([^(),]|\([^()]*\))*[,]([^(),]|\([^()]*\))*\)',
    'g'
  ) as invocation(arguments)
  where n.nspname in ('public','ceit_connect_private')
    and p.prokind='f'
)
and exists(
  select 1
  from negative_fixture
  cross join lateral pg_catalog.regexp_matches(
    negative_fixture.body,
    'classify_executive_dashboard_task[[:space:]]*\(([^(),]|\([^()]*\))*[,]([^(),]|\([^()]*\))*[,]([^(),]|\([^()]*\))*\)',
    'g'
  ) as invocation(arguments)
);

-- This paste owns independent rollback fixtures even though its assertions are
-- catalog-only.
set local session_replication_role=replica;
insert into public.committees(id,name) values('1c100000-0000-4000-8000-000000000001','L1 Catalog');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values('00000000-0000-0000-0000-000000000000','1c110000-0000-4000-8000-000000000001','authenticated','authenticated','l1-catalog@example.invalid','',pg_catalog.now(),pg_catalog.now(),pg_catalog.now());
insert into public.users(id,email,full_name,role,committee_id,is_active)
values('1c110000-0000-4000-8000-000000000001','l1-catalog@example.invalid','L1 Catalog Admin','Admin',null,true);
set local session_replication_role=origin;

-- Impersonation proof comes after the postgres-only helper checks above.
set local role authenticated;
select pg_catalog.set_config('request.jwt.claims','{"sub":"1c110000-0000-4000-8000-000000000001","role":"authenticated"}',true);
reset role;

do $$
declare v_total integer; v_failed text;
begin
  select pg_catalog.count(*),pg_catalog.string_agg(n||' '||label,', ' order by n)
  filter(where not passed) into v_total,v_failed from public.l1_catalog_results;
  if v_total<>14 or v_failed is not null then
    raise exception 'TEST RESULTS FAIL: %',coalesce(v_failed,'wrong result count');
  end if;
  raise exception 'TEST RESULTS 14/14 PASS (intentional rollback)';
end $$;
```
