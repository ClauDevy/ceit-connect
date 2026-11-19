# Batch E step 1 tests

## Admin setting and export paste — Dev only

Run without RLS after applying Batch E. This paste is self-contained and its
expected final count is **14/14**.

`20261031130000_event_deletion.sql` intentionally dropped the historical
`activity_log.task_id` foreign key so deleted-task evidence can retain its UUID.
The subject-ID check still requires non-null task and event IDs. This paste
creates a real confidential task, inserts its semantic row while it exists, and
then deletes it to exercise the Admin reader's genuine fail-closed mask. Every
direct log fixture is checked against the catalog tuple, subject-ID,
confidentiality, and snapshot constraints. Co-Admin and Member calls receive
the fixed CAL04 text; anon is rejected before entry by the EXECUTE revoke, so
its exact PostgreSQL permission text is pinned instead.

```sql
begin;
set local statement_timeout = '180s';
select pg_catalog.set_config('ceit_connect.e1_results', '[]', true);
create function pg_temp.e1_record(p_label text,p_passed boolean) returns void language plpgsql as $$
declare results jsonb:=coalesce(nullif(current_setting('ceit_connect.e1_results',true),''),'[]')::jsonb;
begin perform set_config('ceit_connect.e1_results',(results||jsonb_build_array(jsonb_build_object('label',p_label,'passed',coalesce(p_passed,false))))::text,true);end$$;
create function pg_temp.e1_invalid(p_value integer) returns boolean language plpgsql as $$
declare ok boolean:=false; begin execute 'set local role authenticated';
begin perform public.set_activity_log_retention_days(p_value); exception when sqlstate 'CAL02' then ok:=sqlerrm='The Activity Log retention value is invalid.'; end;
execute 'reset role'; return ok; end$$;
create function pg_temp.e1_denials(p_role text,p_user uuid,p_anon boolean) returns boolean language plpgsql as $$
declare a boolean:=false;b boolean:=false;c boolean:=false; expected text; begin
perform set_config('request.jwt.claims',case when p_user is null then '{}' else jsonb_build_object('sub',p_user,'role','authenticated')::text end,true);
execute format('set local role %I',p_role);
expected:=case when p_anon then 'permission denied for function get_activity_log_retention_setting' else 'Activity Log administration is unavailable.' end;
begin perform public.get_activity_log_retention_setting(); exception when others then a:=sqlerrm=expected and (p_anon or sqlstate='CAL04'); end;
expected:=case when p_anon then 'permission denied for function set_activity_log_retention_days' else 'Activity Log administration is unavailable.' end;
begin perform public.set_activity_log_retention_days(180); exception when others then b:=sqlerrm=expected and (p_anon or sqlstate='CAL04'); end;
expected:=case when p_anon then 'permission denied for function list_activity_log_export' else 'Activity Log administration is unavailable.' end;
begin perform public.list_activity_log_export(p_page_size=>1); exception when others then c:=sqlerrm=expected and (p_anon or sqlstate='CAL04'); end;
execute 'reset role'; return a and b and c; end$$;
do $e1$
declare token text:=gen_random_uuid()::text;a uuid:=gen_random_uuid();c uuid:=gen_random_uuid();m uuid:=gen_random_uuid();committee uuid:=gen_random_uuid();v_event_id uuid:=gen_random_uuid();v_task_id uuid:=gen_random_uuid();masked_id uuid:=gen_random_uuid();purge_id uuid:=gen_random_uuid();base timestamptz:='2099-01-15 12:00+00';i integer;before_n bigint;after_n bigint;n bigint;ids uuid[];newest uuid[];oldest uuid[];more boolean;cursor_at timestamptz;cursor_id uuid;l jsonb;x jsonb;old_at timestamptz;saved_at timestamptz;saved_by uuid;saved_days integer;ok boolean;deleted integer;
begin
if current_user<>'postgres' then raise exception 'Run without RLS as postgres.';end if;
insert into public.committees(id,name) values(committee,'E1 '||token);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
(a,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','e1-a-'||token||'@example.test',crypt('E1-test-1!',gen_salt('bf')),now(),'{}','{}',now(),now()),
(c,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','e1-c-'||token||'@example.test',crypt('E1-test-1!',gen_salt('bf')),now(),'{}','{}',now(),now()),
(m,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','e1-m-'||token||'@example.test',crypt('E1-test-1!',gen_salt('bf')),now(),'{}','{}',now(),now());
perform set_config('ceit_connect.officer_writer','invite_new_officer',true);
insert into public.users(id,email,full_name,role,committee_id,is_active) values(a,'e1-a-'||token||'@example.test','E1 Admin','Admin',null,true),(c,'e1-c-'||token||'@example.test','E1 CoAdmin','Co-Admin',committee,true);
perform set_config('ceit_connect.officer_writer','',true);
insert into public.users(id,email,full_name,role,committee_id,is_active) values(m,'e1-m-'||token||'@example.test','E1 Member','Member',committee,true);
perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
insert into public.events(id,name,start_date,end_date,status,created_by) values(v_event_id,'E1 Event',current_date,current_date+1,'Draft',a);
perform set_config('ceit_connect.task_assignee_writer','create_event_with_tasks',true);perform set_config('ceit_connect.task_access_writer','create_active_event_task',true);
insert into public.tasks(id,event_id,committee_id,title,phase,status,priority,task_type,primary_assignees,assist_assignees,is_confidential,allowed_viewers,created_by,sort_order) values(v_task_id,v_event_id,committee,'E1 confidential','Setup','To Do','Medium','Deliverable','{}','{}',true,array[m],a,1024);
perform set_config('ceit_connect.task_access_writer','',true);perform set_config('ceit_connect.task_assignee_writer','',true);
for i in 1..25 loop insert into public.activity_log(id,user_id,actor_kind,subject_kind,activity_type,event_id,action,changes,created_at) values(gen_random_uuid(),a,'user','event','event_deleted',v_event_id,'DELETE',jsonb_build_object('event_status','Draft','event_name',format('E1 row %s',i)),base+i*interval '1 second');end loop;
insert into public.activity_log(id,task_id,user_id,actor_kind,subject_kind,activity_type,event_id,task_was_confidential,task_title_snapshot,action,changes,created_at) values(masked_id,v_task_id,a,'user','task','task_deleted',v_event_id,true,null,'DELETE',jsonb_build_object('event_id',v_event_id,'committee_id',committee),base+interval '26 seconds');
insert into public.activity_log(id,user_id,actor_kind,subject_kind,activity_type,event_id,task_was_confidential,task_title_snapshot,action,changes,created_at) values(purge_id,a,'user','event','event_created',v_event_id,null,null,'INSERT',jsonb_build_object('event_status','Draft'),now()-interval '100 days');
delete from public.tasks where id=v_task_id;
select count(*)=27 and bool_and(catalog.activity_type is not null and ((log.subject_kind='event' and log.task_id is null and log.event_id is not null and log.task_was_confidential is null and log.task_title_snapshot is null) or (log.id=masked_id and log.task_id=v_task_id and log.event_id=v_event_id and log.task_was_confidential and log.task_title_snapshot is null))) into ok from public.activity_log log join ceit_connect_private.activity_type_catalog catalog on(catalog.activity_type,catalog.broad_action,catalog.subject_kind)=(log.activity_type,log.action,log.subject_kind) where log.id=purge_id or log.created_at>=base and log.created_at<base+interval '1 day';perform pg_temp.e1_record('27 log fixtures satisfy every semantic shape',ok);
select array_agg(id order by created_at desc,id desc),array_agg(id order by created_at,id) into newest,oldest from public.activity_log where created_at>=base and created_at<base+interval '1 day';
execute 'set local role authenticated';select updated_at into old_at from public.set_activity_log_retention_days(30);select retention_days,updated_at,updated_by into saved_days,saved_at,saved_by from public.set_activity_log_retention_days(180);select retention_days,updated_at,updated_by into saved_days,saved_at,saved_by from public.get_activity_log_retention_setting();execute 'reset role';perform pg_temp.e1_record('Admin metadata round trip and updated_at movement',saved_days=180 and saved_by=a and saved_at>old_at);
perform pg_temp.e1_record('Setter rejects 29 with exact text',pg_temp.e1_invalid(29));perform pg_temp.e1_record('Setter rejects 731 with exact text',pg_temp.e1_invalid(731));perform pg_temp.e1_record('Setter rejects null with exact text',pg_temp.e1_invalid(null));
select count(*)=3 and bool_and(proowner='postgres'::regrole and has_function_privilege('authenticated',oid,'EXECUTE') and not has_function_privilege('anon',oid,'EXECUTE') and not has_function_privilege('service_role',oid,'EXECUTE') and not exists(select 1 from aclexplode(coalesce(proacl,acldefault('f',proowner))) q where q.grantee=0 and q.privilege_type='EXECUTE')) into ok from pg_proc where oid in('public.get_activity_log_retention_setting()'::regprocedure,'public.set_activity_log_retention_days(integer)'::regprocedure,'public.list_activity_log_export(text,text,uuid,date,date,text,timestamptz,uuid,integer)'::regprocedure);perform pg_temp.e1_record('Exact authenticated-only grants on all three functions',ok);
select count(*) into before_n from public.activity_log;execute 'set local role authenticated';perform public.set_activity_log_retention_days(180);execute 'reset role';select count(*) into after_n from public.activity_log;perform pg_temp.e1_record('Saving does not purge',before_n=after_n);
execute 'set local role authenticated';select count(*),array_agg(activity_id),bool_and(has_more),(array_agg(next_cursor_created_at))[1],(array_agg(next_cursor_id))[1] into n,ids,more,cursor_at,cursor_id from public.list_activity_log_export(p_sort=>'newest',p_date_from=>base::date,p_date_to=>base::date,p_page_size=>25);ok:=n=25 and ids=newest[1:25] and more;select count(*),array_agg(activity_id),bool_or(has_more) into n,ids,more from public.list_activity_log_export(p_sort=>'newest',p_date_from=>base::date,p_date_to=>base::date,p_cursor_created_at=>cursor_at,p_cursor_id=>cursor_id,p_page_size=>25);execute 'reset role';perform pg_temp.e1_record('Newest count, order, paging, and has_more',ok and n=1 and ids=newest[26:26] and not more);
execute 'set local role authenticated';select count(*),array_agg(activity_id),bool_and(has_more),(array_agg(next_cursor_created_at))[1],(array_agg(next_cursor_id))[1] into n,ids,more,cursor_at,cursor_id from public.list_activity_log_export(p_sort=>'oldest',p_date_from=>base::date,p_date_to=>base::date,p_page_size=>25);ok:=n=25 and ids=oldest[1:25] and more;select count(*),array_agg(activity_id),bool_or(has_more) into n,ids,more from public.list_activity_log_export(p_sort=>'oldest',p_date_from=>base::date,p_date_to=>base::date,p_cursor_created_at=>cursor_at,p_cursor_id=>cursor_id,p_page_size=>25);execute 'reset role';perform pg_temp.e1_record('Oldest count, order, paging, and has_more',ok and n=1 and ids=oldest[26:26] and not more);
execute 'set local role authenticated';select coalesce(jsonb_agg(to_jsonb(r) order by activity_created_at desc,activity_id desc),'[]') into l from public.list_activity_log(p_sort=>'newest',p_date_from=>base::date,p_date_to=>base::date,p_search=>'Confidential Task',p_page_size=>20)r;select coalesce(jsonb_agg(to_jsonb(r) order by activity_created_at desc,activity_id desc),'[]') into x from public.list_activity_log_export(p_sort=>'newest',p_date_from=>base::date,p_date_to=>base::date,p_search=>'Confidential Task',p_page_size=>20)r;execute 'reset role';perform pg_temp.e1_record('Filtered export has reader parity and exact mask',x=l and jsonb_array_length(x)=1 and x->0->>'activity_id'=masked_id::text and (x->0->>'is_masked')::boolean and x->0->>'task_title'='Confidential Task' and x->0->>'task_id' is null and x->0->>'actor_name' is null and x->0->'change_summary'='null'::jsonb and not(x->0->>'has_more')::boolean);
perform pg_temp.e1_record('Co-Admin exact getter/setter/export denial',pg_temp.e1_denials('authenticated',c,false));perform pg_temp.e1_record('Member exact getter/setter/export denial',pg_temp.e1_denials('authenticated',m,false));perform pg_temp.e1_record('Anon exact grant-level getter/setter/export denial',pg_temp.e1_denials('anon',null,true));
perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);execute 'set local role authenticated';perform public.set_activity_log_retention_days(180);execute 'reset role';deleted:=public.purge_activity_log();ok:=exists(select 1 from public.activity_log where id=purge_id);execute 'set local role authenticated';perform public.set_activity_log_retention_days(30);execute 'reset role';while exists(select 1 from public.activity_log where id=purge_id) loop deleted:=public.purge_activity_log();exit when deleted=0;end loop;perform pg_temp.e1_record('Purge keeps 100-day row at 180 and deletes it at 30',ok and not exists(select 1 from public.activity_log where id=purge_id));
end$e1$;
do $results$ declare r record;p integer;t integer;failed text;results jsonb:=current_setting('ceit_connect.e1_results')::jsonb;begin for r in select value,ordinality from jsonb_array_elements(results) with ordinality loop raise notice '% %: %',lpad(r.ordinality::text,2,'0'),r.value->>'label',case when (r.value->>'passed')::boolean then 'PASS' else 'FAIL' end;end loop;select count(*)filter(where (value->>'passed')::boolean),count(*) into p,t from jsonb_array_elements(results);select string_agg(value->>'label',', ' order by ordinality) into failed from jsonb_array_elements(results) with ordinality where not(value->>'passed')::boolean;raise exception 'TEST RESULTS %/% PASS; FAILED: % (intentional rollback)',p,t,coalesce(failed,'none');end$results$;
rollback;
```

## Ported Batch 12b retention regression — Dev only

Run without RLS after applying Batch E. This complete port resets the saved
setting to 30 before measuring its baseline and changes only the retention
function catalog expectation from immutable to stable. Its expected final count
is **19/19**; the final intentional exception lists failed labels.

```sql
begin;
set local statement_timeout = '180s';

update ceit_connect_private.activity_log_settings
set retention_days = 30,
    updated_at = pg_catalog.clock_timestamp(),
    updated_by = null
where singleton;

do $setup$
declare
  v_token text := gen_random_uuid()::text;
  v_admin_id uuid := gen_random_uuid();
  v_committee_id uuid := gen_random_uuid();
  v_event_id uuid := gen_random_uuid();
  v_empty_task_id uuid := gen_random_uuid();
  v_live_task_id uuid := gen_random_uuid();
  v_boundary_id uuid := gen_random_uuid();
  v_newer_id uuid := gen_random_uuid();
  v_baseline_old bigint;
  v_inserted_old bigint;
  v_snapshot jsonb;
begin
  if current_user <> 'postgres' then
    raise exception 'FAIL [SETUP] Run without RLS as postgres; current_user is %.', current_user;
  end if;

  select count(*)
  into v_baseline_old
  from public.activity_log
  where created_at
    < now() - pg_catalog.make_interval(
        days => public.activity_log_retention_days()
      );

  perform pg_catalog.set_config('ceit_connect.test_token', v_token, true);
  perform pg_catalog.set_config('ceit_connect.test_admin_id', v_admin_id::text, true);
  perform pg_catalog.set_config('ceit_connect.test_committee_id', v_committee_id::text, true);
  perform pg_catalog.set_config('ceit_connect.test_event_id', v_event_id::text, true);
  perform pg_catalog.set_config('ceit_connect.test_empty_task_id', v_empty_task_id::text, true);
  perform pg_catalog.set_config('ceit_connect.test_live_task_id', v_live_task_id::text, true);
  perform pg_catalog.set_config('ceit_connect.test_boundary_id', v_boundary_id::text, true);
  perform pg_catalog.set_config('ceit_connect.test_newer_id', v_newer_id::text, true);
  perform pg_catalog.set_config('ceit_connect.test_baseline_old', v_baseline_old::text, true);
  perform pg_catalog.set_config(
    'ceit_connect.test_absent_search',
    'absent-' || gen_random_uuid()::text,
    true
  );

  insert into auth.users (
    id,
    instance_id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  ) values (
    v_admin_id,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated',
    'authenticated',
    'retention-' || v_token || '@example.test',
    crypt('Retention-test-1!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    pg_catalog.jsonb_build_object('test_token', v_token),
    now(),
    now()
  );

  insert into public.committees (id, name)
  values (v_committee_id, 'Retention ' || v_token);

  perform pg_catalog.set_config(
    'ceit_connect.officer_writer',
    'invite_new_officer',
    true
  );
  insert into public.users (
    id, email, full_name, role, committee_id, is_active
  ) values (
    v_admin_id,
    'retention-' || v_token || '@example.test',
    'Retention Admin ' || v_token,
    'Admin',
    null,
    true
  );
  perform pg_catalog.set_config('ceit_connect.officer_writer', '', true);

  insert into public.events (
    id, name, start_date, status, created_by
  ) values (
    v_event_id,
    'Retention Event ' || v_token,
    current_date,
    'Draft',
    v_admin_id
  );

  perform pg_catalog.set_config(
    'ceit_connect.task_assignee_writer',
    'create_event_with_tasks',
    true
  );
  insert into public.tasks (
    id,
    event_id,
    committee_id,
    title,
    phase,
    primary_assignees,
    assist_assignees,
    created_by
  ) values
    (
      v_empty_task_id,
      v_event_id,
      v_committee_id,
      'Entirely purged ' || v_token,
      'Retention',
      '{}'::uuid[],
      '{}'::uuid[],
      v_admin_id
    ),
    (
      v_live_task_id,
      v_event_id,
      v_committee_id,
      'Live retained ' || v_token,
      'Retention',
      '{}'::uuid[],
      '{}'::uuid[],
      v_admin_id
    );
  perform pg_catalog.set_config('ceit_connect.task_assignee_writer', '', true);

  update public.activity_log
  set created_at = now() - interval '31 days'
  where task_id in (v_empty_task_id, v_live_task_id)
    and action = 'INSERT';

  insert into public.activity_log (
    id, task_id, user_id, action, changes, created_at
  )
  select
    gen_random_uuid(),
    v_live_task_id,
    v_admin_id,
    case series_row.value % 3
      when 0 then 'INSERT'
      when 1 then 'UPDATE'
      else 'DELETE'
    end,
    case series_row.value % 3
      when 1 then pg_catalog.jsonb_build_object(
        'old', pg_catalog.jsonb_build_object(
          'id', v_live_task_id::text,
          'event_id', v_event_id::text,
          'committee_id', v_committee_id::text,
          'title', 'bulk-old-' || v_token || '-' || series_row.value,
          'is_confidential', series_row.value % 2 = 0
        ),
        'new', pg_catalog.jsonb_build_object(
          'id', v_live_task_id::text,
          'event_id', v_event_id::text,
          'committee_id', v_committee_id::text,
          'title', 'bulk-new-' || v_token || '-' || series_row.value,
          'is_confidential', series_row.value % 2 = 0
        )
      )
      else pg_catalog.jsonb_build_object(
        'id', v_live_task_id::text,
        'event_id', v_event_id::text,
        'committee_id', v_committee_id::text,
        'title', 'bulk-' || v_token || '-' || series_row.value,
        'is_confidential', series_row.value % 2 = 0
      )
    end,
    now() - interval '31 days' - series_row.value * interval '1 microsecond'
  from pg_catalog.generate_series(1, 5003) as series_row(value);

  v_snapshot := pg_catalog.jsonb_build_object(
    'id', v_live_task_id::text,
    'event_id', v_event_id::text,
    'committee_id', v_committee_id::text,
    'title', 'Boundary ' || v_token,
    'is_confidential', false
  );

  insert into public.activity_log (
    id, task_id, user_id, action, changes, created_at
  ) values
    (
      v_boundary_id,
      null,
      v_admin_id,
      'DELETE',
      v_snapshot,
      now() - pg_catalog.make_interval(
        days => public.activity_log_retention_days()
      )
    ),
    (
      v_newer_id,
      null,
      v_admin_id,
      'DELETE',
      v_snapshot || pg_catalog.jsonb_build_object(
        'title', 'Newer ' || v_token
      ),
      now() - interval '29 days'
    );

  insert into public.activity_log (
    id, task_id, user_id, action, changes, created_at
  )
  select
    gen_random_uuid(),
    v_live_task_id,
    v_admin_id,
    'UPDATE',
    pg_catalog.jsonb_build_object(
      'old', pg_catalog.jsonb_build_object(
        'id', v_live_task_id::text,
        'event_id', v_event_id::text,
        'committee_id', v_committee_id::text,
        'title', 'page-' || v_token || '-' || series_row.value,
        'is_confidential', false
      ),
      'new', pg_catalog.jsonb_build_object(
        'id', v_live_task_id::text,
        'event_id', v_event_id::text,
        'committee_id', v_committee_id::text,
        'title', 'page-' || v_token || '-' || series_row.value,
        'is_confidential', false
      )
    ),
    now() - interval '1 day' + series_row.value * interval '1 microsecond'
  from pg_catalog.generate_series(1, 25) as series_row(value);

  insert into public.activity_log (
    id, task_id, user_id, action, changes, created_at
  )
  select
    gen_random_uuid(),
    null,
    v_admin_id,
    'DELETE',
    pg_catalog.jsonb_build_object(
      'id', gen_random_uuid()::text,
      'event_id', v_event_id::text,
      'committee_id', v_committee_id::text,
      'title', 'scan-candidate-' || series_row.value,
      'is_confidential', false
    ),
    now() + interval '1 day' + series_row.value * interval '1 microsecond'
  from pg_catalog.generate_series(1, 2001) as series_row(value);

  select count(*) - v_baseline_old
  into v_inserted_old
  from public.activity_log
  where created_at
    < now() - pg_catalog.make_interval(
        days => public.activity_log_retention_days()
      );

  if v_inserted_old < 5003 then
    raise exception 'FAIL [SETUP] Expected at least 5003 crafted old rows, found %.',
      v_inserted_old;
  end if;

  perform pg_catalog.set_config(
    'ceit_connect.test_inserted_old',
    v_inserted_old::text,
    true
  );
end;
$setup$;

do $catalog$
declare
  v_ok boolean;
  v_rejected boolean;
  v_boundary_id uuid := current_setting('ceit_connect.test_boundary_id')::uuid;
begin
  select
    public.activity_log_retention_days() = 30
    and procedure_row.proowner = 'postgres'::regrole
    and procedure_row.provolatile = 's'
    and procedure_row.prosecdef is false
    and procedure_row.proconfig @> array['search_path=""']::text[]
  into v_ok
  from pg_catalog.pg_proc as procedure_row
  where procedure_row.oid = 'public.activity_log_retention_days()'::regprocedure;

  if not coalesce(v_ok, false) then
    raise exception 'FAIL [01 retention contract] Expected postgres-owned stable invoker function returning 30 with empty search_path.';
  end if;
  raise notice 'PASS [01 retention contract] fixed retention function returns 30 and has the required catalog shape';

  select
    purge_row.proowner = 'postgres'::regrole
    and purge_row.provolatile = 'v'
    and purge_row.prosecdef
    and purge_row.proconfig @> array['search_path=""']::text[]
    and guard_row.proowner = 'postgres'::regrole
    and guard_row.prosecdef is false
    and guard_row.proconfig @> array['search_path=""']::text[]
    and trigger_row.tgenabled = 'O'
    and (trigger_row.tgtype & 1) = 0
    and (trigger_row.tgtype & 2) = 2
    and (trigger_row.tgtype & 8) = 8
    and (trigger_row.tgtype & 32) = 32
    and index_row.indisvalid
    and index_row.indisready
    and pg_catalog.pg_get_indexdef(index_row.indexrelid)
      like '%(created_at, id)%'
  into v_ok
  from pg_catalog.pg_proc as purge_row
  cross join pg_catalog.pg_proc as guard_row
  cross join pg_catalog.pg_trigger as trigger_row
  cross join pg_catalog.pg_index as index_row
  where purge_row.oid = 'public.purge_activity_log()'::regprocedure
    and guard_row.oid = 'public.guard_activity_log_deletes()'::regprocedure
    and trigger_row.tgrelid = 'public.activity_log'::regclass
    and trigger_row.tgname = 'activity_log_guard_deletes'
    and not trigger_row.tgisinternal
    and trigger_row.tgfoid = guard_row.oid
    and index_row.indexrelid = 'public.activity_log_created_at_id_idx'::regclass;

  if not coalesce(v_ok, false) then
    raise exception 'FAIL [02 purge guard and index] Catalog shape, trigger events, or (created_at, id) index changed.';
  end if;
  raise notice 'PASS [02 purge guard and index] purge, statement guard, trigger events, and ordered index match the contract';

  select not exists (
    select 1
    from pg_catalog.pg_class as class_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        class_row.relacl,
        pg_catalog.acldefault('r', class_row.relowner)
      )
    ) as privilege_row
    where class_row.oid = 'public.activity_log'::regclass
      and privilege_row.grantee in (
        0::oid,
        'anon'::regrole::oid,
        'authenticated'::regrole::oid
      )
  ) and not exists (
    select 1
    from pg_catalog.pg_proc as procedure_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        procedure_row.proacl,
        pg_catalog.acldefault('f', procedure_row.proowner)
      )
    ) as privilege_row
    where procedure_row.oid in (
      'public.activity_log_retention_days()'::regprocedure,
      'public.guard_activity_log_deletes()'::regprocedure,
      'public.purge_activity_log()'::regprocedure
    )
      and privilege_row.grantee in (
        0::oid,
        'anon'::regrole::oid,
        'authenticated'::regrole::oid
      )
  ) and not pg_catalog.has_function_privilege(
    'anon', 'public.purge_activity_log()', 'EXECUTE'
  ) and not pg_catalog.has_function_privilege(
    'authenticated', 'public.purge_activity_log()', 'EXECUTE'
  )
  into v_ok;

  if not coalesce(v_ok, false) then
    raise exception 'FAIL [03 privilege closure] PUBLIC/anon/authenticated retain a table privilege or retention-function EXECUTE.';
  end if;
  raise notice 'PASS [03 privilege closure] PUBLIC, anon, and authenticated have no direct table privilege or retention-function EXECUTE';

  v_rejected := false;
  begin
    delete from public.activity_log where id = v_boundary_id;
  exception when sqlstate 'CAL03' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'FAIL [04 raw postgres delete] DELETE without the maintenance guard unexpectedly succeeded.';
  end if;
  raise notice 'PASS [04 raw postgres delete] postgres DELETE without the guard is rejected';

  perform pg_catalog.set_config(
    'ceit_connect.activity_log_purger',
    'x',
    true
  );
  v_rejected := false;
  begin
    delete from public.activity_log where id = v_boundary_id;
  exception when sqlstate 'CAL03' then
    v_rejected := true;
  end;
  perform pg_catalog.set_config('ceit_connect.activity_log_purger', '', true);
  if not v_rejected then
    raise exception 'FAIL [05 wrong guard] DELETE with an incorrect guard value unexpectedly succeeded.';
  end if;
  raise notice 'PASS [05 wrong guard] postgres DELETE with an incorrect guard value is rejected';
end;
$catalog$;

set local role anon;
do $anon_execute$
declare
  v_rejected boolean := false;
begin
  begin
    perform public.purge_activity_log();
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'FAIL [06 anon EXECUTE revoke] anon reached purge_activity_log().';
  end if;
  raise notice 'PASS [06 anon EXECUTE revoke] anon cannot execute purge_activity_log()';
end;
$anon_execute$;
reset role;

set local role authenticated;
do $authenticated_execute$
declare
  v_rejected boolean := false;
begin
  begin
    perform public.purge_activity_log();
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'FAIL [07 authenticated EXECUTE revoke] authenticated reached purge_activity_log().';
  end if;
  raise notice 'PASS [07 authenticated EXECUTE revoke] authenticated cannot execute purge_activity_log()';
end;
$authenticated_execute$;
reset role;

do $client_delete_claims$
begin
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', current_setting('ceit_connect.test_admin_id'),
      'role', 'authenticated'
    )::text,
    true
  );
end;
$client_delete_claims$;

set local role anon;
do $anon_delete$
declare
  v_rejected boolean := false;
begin
  begin
    delete from public.activity_log
    where id = current_setting('ceit_connect.test_boundary_id')::uuid;
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'FAIL [08 client DELETE revoke] anon DELETE unexpectedly succeeded.';
  end if;
end;
$anon_delete$;
reset role;

set local role authenticated;
do $authenticated_delete$
declare
  v_rejected boolean := false;
begin
  begin
    delete from public.activity_log
    where id = current_setting('ceit_connect.test_boundary_id')::uuid;
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'FAIL [08 client DELETE revoke] authenticated DELETE unexpectedly succeeded.';
  end if;
  raise notice 'PASS [08 client DELETE revoke] anon and authenticated cannot delete activity rows directly';
end;
$authenticated_delete$;
reset role;

do $truncate$
declare
  v_rejected boolean := false;
begin
  begin
    execute 'truncate table public.activity_log';
  exception when sqlstate 'CAL03' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'FAIL [09 postgres TRUNCATE] Activity Log truncation unexpectedly succeeded.';
  end if;
  raise notice 'PASS [09 postgres TRUNCATE] Activity Log truncation is rejected';
end;
$truncate$;

do $purge$
declare
  v_token text := current_setting('ceit_connect.test_token');
  v_baseline_old bigint := current_setting('ceit_connect.test_baseline_old')::bigint;
  v_inserted_old bigint := current_setting('ceit_connect.test_inserted_old')::bigint;
  v_expected_deleted bigint := v_baseline_old + v_inserted_old;
  v_before_count bigint;
  v_after_count bigint;
  v_first integer;
  v_batch integer;
  v_total_deleted bigint;
  v_zero integer;
  v_remaining bigint;
  v_rejected boolean := false;
begin
  select count(*) into v_before_count from public.activity_log;

  v_first := public.purge_activity_log();
  if v_first <> 5000 then
    raise exception 'FAIL [10 first batch cap] Expected exactly 5000 deletions, got %.', v_first;
  end if;
  raise notice 'PASS [10 first batch cap] first purge deletes exactly 5000 rows';

  v_total_deleted := v_first;
  loop
    v_batch := public.purge_activity_log();
    v_total_deleted := v_total_deleted + v_batch;
    exit when v_batch < 5000;
  end loop;

  if v_total_deleted <> v_expected_deleted then
    raise exception 'FAIL [11 relative drain] Expected baseline % + inserted % = % total deletions, got %.',
      v_baseline_old, v_inserted_old, v_expected_deleted, v_total_deleted;
  end if;
  raise notice 'PASS [11 relative drain] total deleted equals baseline plus inserted rows and the drain ends below 5000';

  v_zero := public.purge_activity_log();
  if v_zero <> 0 then
    raise exception 'FAIL [12 final idempotent run] Expected 0 after the sub-cap batch, got %.', v_zero;
  end if;
  raise notice 'PASS [12 final idempotent run] one more purge returns 0';

  select count(*)
  into v_remaining
  from public.activity_log
  where created_at
      < now() - pg_catalog.make_interval(
          days => public.activity_log_retention_days()
        )
    and changes::text like '%' || v_token || '%';

  if v_remaining <> 0 then
    raise exception 'FAIL [13 uniform retention] % token-owned old INSERT/UPDATE/DELETE or confidential/public rows remain.', v_remaining;
  end if;
  raise notice 'PASS [13 uniform retention] old INSERT, UPDATE, DELETE, public, and confidential rows are all purged';

  if not exists (
       select 1 from public.activity_log
       where id = current_setting('ceit_connect.test_boundary_id')::uuid
     ) or not exists (
       select 1 from public.activity_log
       where id = current_setting('ceit_connect.test_newer_id')::uuid
     ) then
    raise exception 'FAIL [14 boundary and newer rows] Exact-boundary or newer fixture was deleted.';
  end if;
  raise notice 'PASS [14 boundary and newer rows] exact 30-day boundary and newer rows are retained';

  select count(*) into v_after_count from public.activity_log;
  if v_before_count - v_after_count <> v_total_deleted then
    raise exception 'FAIL [15 purge silence] Row-count delta % differs from returned deletions %.',
      v_before_count - v_after_count, v_total_deleted;
  end if;
  raise notice 'PASS [15 purge silence] purge writes no replacement activity row';

  begin
    delete from public.activity_log
    where id = current_setting('ceit_connect.test_boundary_id')::uuid;
  exception when sqlstate 'CAL03' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'FAIL [16 guard reset after purge] Raw DELETE succeeded after purge_activity_log() in the same transaction.';
  end if;
  raise notice 'PASS [16 guard reset after purge] raw postgres DELETE fails again after purge_activity_log() in the same transaction';
end;
$purge$;

do $reader_claims$
begin
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', current_setting('ceit_connect.test_admin_id'),
      'role', 'authenticated'
    )::text,
    true
  );
end;
$reader_claims$;

set local role authenticated;
do $reader$
declare
  v_token text := current_setting('ceit_connect.test_token');
  v_first_ids uuid[];
  v_second_ids uuid[];
  v_cursor_created_at timestamptz;
  v_cursor_id uuid;
  v_first_count integer;
  v_second_count integer;
  v_first_has_more boolean;
  v_second_has_more boolean;
  v_empty_count integer;
  v_sentinel_count integer;
  v_sentinel_ok boolean;
begin
  select count(*)
  into v_empty_count
  from public.list_activity_log(
    p_task_id => current_setting('ceit_connect.test_empty_task_id')::uuid
  );

  if v_empty_count <> 0 then
    raise exception 'FAIL [17 entirely purged History] Expected an empty reader result, got % rows.', v_empty_count;
  end if;
  raise notice 'PASS [17 entirely purged History] a task whose whole history aged out returns an ordinary empty result';

  select
    pg_catalog.array_agg(page.activity_id order by page.activity_created_at desc, page.activity_id desc),
    count(*)::integer,
    pg_catalog.bool_and(page.has_more),
    (pg_catalog.array_agg(page.next_cursor_created_at))[1],
    (pg_catalog.array_agg(page.next_cursor_id))[1]
  into
    v_first_ids,
    v_first_count,
    v_first_has_more,
    v_cursor_created_at,
    v_cursor_id
  from public.list_activity_log(
    p_task_id => current_setting('ceit_connect.test_live_task_id')::uuid,
    p_sort => 'newest',
    p_search => 'page-' || v_token,
    p_page_size => 20
  ) as page;

  select
    pg_catalog.array_agg(page.activity_id order by page.activity_created_at desc, page.activity_id desc),
    count(*)::integer,
    coalesce(pg_catalog.bool_or(page.has_more), false)
  into v_second_ids, v_second_count, v_second_has_more
  from public.list_activity_log(
    p_task_id => current_setting('ceit_connect.test_live_task_id')::uuid,
    p_sort => 'newest',
    p_search => 'page-' || v_token,
    p_cursor_created_at => v_cursor_created_at,
    p_cursor_id => v_cursor_id,
    p_page_size => 20
  ) as page;

  if v_first_count <> 20
     or not coalesce(v_first_has_more, false)
     or v_cursor_created_at is null
     or v_cursor_id is null
     or v_second_count <> 5
     or v_second_has_more
     or exists (
       select 1
       from pg_catalog.unnest(v_first_ids) as first_id(id)
       join pg_catalog.unnest(v_second_ids) as second_id(id)
         using (id)
     )
     or exists (
       select 1
       from public.list_activity_log(
         p_task_id => current_setting('ceit_connect.test_live_task_id')::uuid,
         p_search => 'page-' || v_token
       ) as page
       where page.action <> 'UPDATE'
     ) then
    raise exception 'FAIL [18 retained live-task paging] Expected 20+5 duplicate-free UPDATE rows after the INSERT aged out.';
  end if;
  raise notice 'PASS [18 retained live-task paging] a live task works without its INSERT row and retained keyset pages are 20 plus 5 without duplicates';

  select
    count(*)::integer,
    pg_catalog.bool_and(
      page.activity_id is null
      and page.activity_created_at is null
      and page.action is null
      and page.has_more
      and page.next_cursor_created_at is not null
      and page.next_cursor_id is not null
    )
  into v_sentinel_count, v_sentinel_ok
  from public.list_activity_log(
    p_sort => 'newest',
    p_action => 'DELETE',
    p_search => current_setting('ceit_connect.test_absent_search'),
    p_page_size => 20
  ) as page;

  if v_sentinel_count <> 1 or not coalesce(v_sentinel_ok, false) then
    raise exception 'FAIL [19 scan-cap sentinel] Expected one null-activity sentinel with an exact continuation cursor.';
  end if;
  raise notice 'PASS [19 scan-cap sentinel] the 2000-candidate cap still returns one safe sentinel and continuation cursor';
end;
$reader$;
reset role;

do $results$
begin
  raise exception 'TEST RESULTS: 19/19 PASS; FAILED: none (intentional rollback)';
end;
$results$;
```


