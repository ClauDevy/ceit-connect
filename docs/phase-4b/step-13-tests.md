# Step 13 — Dev SQL verification

Run only in the **Dev** SQL Editor, with **Run without RLS** enabled. Never paste into Prod. Every paste owns its Auth/profile fixtures, uses a unique `raw_user_meta_data.test_token`, includes explicit impersonation, and finishes with an intentional `TEST RESULTS` exception so the transaction can be rolled back. After the exception, run `rollback;` if the editor leaves the transaction aborted.

## Paste 1 — catalog, policies, markers, grants

Expected result lines: **2** — one single JSONB catalog row, then `TEST RESULTS: STEP 13 CATALOG PASS`.

```sql
begin;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values(gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  'step13-catalog-'||gen_random_uuid()||'@example.test',crypt('Step13-test-1!',gen_salt('bf')),now(),
  '{"provider":"email","providers":["email"]}',jsonb_build_object('test_token','step13-catalog-'||gen_random_uuid()),now(),now());

select jsonb_build_object(
  'policies', (select jsonb_object_agg(policyname, qual order by policyname)
    from pg_policies where schemaname='public' and policyname in ('events_delete','tasks_delete')),
  'table', (select jsonb_build_object('rls',relrowsecurity,'fk_delete',confdeltype)
    from pg_class c join pg_constraint k on k.conrelid=c.oid and k.conname='task_leave_requests_task_id_fkey'
    where c.oid='public.task_leave_requests'::regclass),
  'triggers', (select jsonb_agg(tgname order by tgname) from pg_trigger
    where tgrelid in ('public.events'::regclass,'public.tasks'::regclass) and not tgisinternal
      and tgname in ('events_enforce_creator_draft_cap','tasks_guard_access_writes','tasks_cancel_stale_leave_requests','events_cancel_inactive_leave_requests')),
  'functions', (select jsonb_agg(jsonb_build_object(
      'signature',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),
      'definer',p.prosecdef,'search_path',p.proconfig,'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE')) order by p.oid::regprocedure::text)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'create_event_with_tasks','edit_event_with_tasks','enforce_creator_draft_event_cap',
      'guard_task_access_writes','set_task_confidentiality','create_active_event_task',
      'edit_active_event_task','unassign_self','cancel_task_leave_request',
      'resolve_task_leave_request','list_pending_task_leave_requests',
      'volunteer_for_task','accept_task_volunteer','guard_task_assignee_writes')),
  'client_table_privileges', (select coalesce(jsonb_agg(jsonb_build_object('table',table_name,'privilege',privilege_type)), '[]')
    from information_schema.role_table_grants where grantee in ('anon','authenticated')
      and table_schema='public' and table_name='task_leave_requests'),
  'body_guards', jsonb_build_object(
    'access_marker_defaulted', position('coalesce(pg_catalog.current_setting(''ceit_connect.task_access_writer'', true),'''')'
      in pg_get_functiondef('public.guard_task_access_writes()'::regprocedure))>0,
    'access_trust_defaulted', position('current_user=''postgres'' and coalesce(v_writer,'''') in'
      in pg_get_functiondef('public.guard_task_access_writes()'::regprocedure))>0,
    'assignee_marker_defaulted', position('coalesce(current_setting(''ceit_connect.task_assignee_writer'',true),'''')'
      in pg_get_functiondef('public.guard_task_assignee_writes()'::regprocedure))>0,
    'self_marker_defaulted', position('coalesce(current_setting(''ceit_connect.task_self_assignment_writer'',true),'''')'
      in pg_get_functiondef('public.guard_task_assignee_writes()'::regprocedure))>0,
    'assignee_trust_defaulted', position('current_user=''postgres'' and coalesce(v_writer,'''') in'
      in pg_get_functiondef('public.guard_task_assignee_writes()'::regprocedure))>0,
    'self_comparison_defaulted', position('coalesce(v_writer,'''')<>''claim_task'' and coalesce(v_self_writer,'''')<>''volunteer_for_task'''
      in pg_get_functiondef('public.guard_task_assignee_writes()'::regprocedure))>0,
    'accept_step12_dropped', to_regprocedure('public.accept_task_volunteer_step12(uuid,uuid)') is null,
    'accept_deletes_offer_before_task_update',
      position('where volunteer_row.task_id=p_task_id and volunteer_row.user_id=p_user_id;'
        in (select prosrc from pg_proc where oid='public.accept_task_volunteer(uuid,uuid)'::regprocedure))
      < position('update public.tasks task_row'
        in (select prosrc from pg_proc where oid='public.accept_task_volunteer(uuid,uuid)'::regprocedure))
  )
) as step_13_catalog;

do $$ begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='create_event_with_tasks') <> 1 then
    raise exception 'create_event_with_tasks overload drift';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='edit_event_with_tasks') <> 1 then
    raise exception 'edit_event_with_tasks overload drift';
  end if;
  if exists(select 1 from information_schema.role_table_grants where grantee in ('anon','authenticated')
      and table_schema='public' and table_name='task_leave_requests') then
    raise exception 'leave table grant drift';
  end if;
  if position('coalesce(pg_catalog.current_setting(''ceit_connect.task_access_writer'', true),'''')'
       in pg_get_functiondef('public.guard_task_access_writes()'::regprocedure))=0
     or position('current_user=''postgres'' and coalesce(v_writer,'''') in'
       in pg_get_functiondef('public.guard_task_access_writes()'::regprocedure))=0
     or position('coalesce(current_setting(''ceit_connect.task_assignee_writer'',true),'''')'
       in pg_get_functiondef('public.guard_task_assignee_writes()'::regprocedure))=0
     or position('coalesce(current_setting(''ceit_connect.task_self_assignment_writer'',true),'''')'
       in pg_get_functiondef('public.guard_task_assignee_writes()'::regprocedure))=0
     or position('current_user=''postgres'' and coalesce(v_writer,'''') in'
       in pg_get_functiondef('public.guard_task_assignee_writes()'::regprocedure))=0
     or position('coalesce(v_writer,'''')<>''claim_task'' and coalesce(v_self_writer,'''')<>''volunteer_for_task'''
       in pg_get_functiondef('public.guard_task_assignee_writes()'::regprocedure))=0 then
    raise exception 'null-safe marker guard drift';
  end if;
  if position('where volunteer_row.task_id=p_task_id and volunteer_row.user_id=p_user_id;'
       in (select prosrc from pg_proc where oid='public.accept_task_volunteer(uuid,uuid)'::regprocedure))
     >= position('update public.tasks task_row'
       in (select prosrc from pg_proc where oid='public.accept_task_volunteer(uuid,uuid)'::regprocedure)) then
    raise exception 'accept offer deletion order drift';
  end if;
  if to_regprocedure('public.accept_task_volunteer_step12(uuid,uuid)') is not null then
    raise exception 'unused accept_task_volunteer_step12 still exists';
  end if;
  raise exception 'TEST RESULTS: STEP 13 CATALOG PASS';
end $$;
```

## Paste 2 — Draft cap 9/10/11 and raw-delete boundaries

Expected result lines: **1** — `TEST RESULTS: STEP 13 DRAFT CAP 9/10/11 PASS`.

```sql
begin;
do $$
declare a uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); token text:='step13-draft-'||gen_random_uuid();
begin
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values(a,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',token||'@example.test',crypt('Step13-test-1!',gen_salt('bf')),now(),
    '{"provider":"email","providers":["email"]}',jsonb_build_object('test_token',token),now(),now());
  insert into public.committees(id,name) values(c,'Step 13 Draft '||token);
  perform set_config('ceit_connect.officer_writer','invite_new_officer',true);
  insert into public.users(id,email,full_name,role,committee_id,is_active)
  values(a,token||'@example.test','Draft Admin','Admin',null,true);
  perform set_config('ceit_connect.officer_writer','',true);
  perform set_config('ceit_connect.test_actor',a::text,true);
  perform set_config('ceit_connect.test_token',token,true);
end $$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('ceit_connect.test_actor'),'role','authenticated')::text,true);
insert into public.events(name,start_date,status,created_by)
select current_setting('ceit_connect.test_token')||'-draft-'||n,current_date,'Draft',current_setting('ceit_connect.test_actor')::uuid
from generate_series(1,9) n;
do $$ begin
  if (select count(*) from public.events where created_by=auth.uid() and status='Draft')<>9 then raise exception '9 boundary failed'; end if;
end $$;
insert into public.events(name,start_date,status,created_by)
values(current_setting('ceit_connect.test_token')||'-draft-10',current_date,'Draft',auth.uid());
do $$ begin
  begin
    insert into public.events(name,start_date,status,created_by)
    values(current_setting('ceit_connect.test_token')||'-draft-11',current_date,'Draft',auth.uid());
    raise exception '11th Draft unexpectedly succeeded';
  exception when sqlstate 'CCD01' then null; end;
  if (select count(*) from public.events where created_by=auth.uid() and status='Draft')<>10 then raise exception '10 boundary failed'; end if;
end $$;
-- Raw Admin DELETE succeeds for Draft, but an Active row is outside events_delete.
delete from public.events where name=current_setting('ceit_connect.test_token')||'-draft-10';
insert into public.events(name,start_date,end_date,status,created_by)
values(current_setting('ceit_connect.test_token')||'-active',current_date,current_date,'Active',auth.uid());
do $$ begin
  delete from public.events where name=current_setting('ceit_connect.test_token')||'-active';
  if found then raise exception 'raw Active delete unexpectedly succeeded'; end if;
  raise exception 'TEST RESULTS: STEP 13 DRAFT CAP 9/10/11 PASS';
end $$;
```

Serialized-loser supplement (two Dev SQL Editor tabs when concurrent execution is available): use the same fixture creator with 9 Drafts. In both tabs start a transaction, impersonate that creator as above, and insert Draft 10. Hold Tab A before commit; Tab B must wait on `draft_event_creator_lock_key(creator)`. Commit A; Tab B must fail with `CCD01`. Repeat with reversed arrival. Expected committed count: 10, never 11. The equivalent Edit Event overlap must take sorted user locks, existing event row, then the same creator lock; no deadlock is acceptable.

Read-only over-cap query — run separately on **Dev**, then **Prod**; it changes nothing:

```sql
select e.created_by, u.full_name, count(*)::integer as draft_count
from public.events e
left join public.users u on u.id=e.created_by
where e.status='Draft'
group by e.created_by,u.full_name
having count(*)>10
order by draft_count desc,e.created_by;
```

## Paste 3 — leave and volunteer caps 19/20/21, stale history, officer paths

Expected result lines: **1** — `TEST RESULTS: STEP 13 LEAVE/VOLUNTEER 19/20/21 PASS`.

```sql
begin;
do $$
declare m uuid:=gen_random_uuid(); o uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); e uuid:=gen_random_uuid(); token text:='step13-requests-'||gen_random_uuid();
begin
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values
    (m,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',token||'-m@example.test',crypt('Step13-test-1!',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}',jsonb_build_object('test_token',token||'-member'),now(),now()),
    (o,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',token||'-o@example.test',crypt('Step13-test-1!',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}',jsonb_build_object('test_token',token||'-officer'),now(),now());
  insert into public.committees(id,name) values(c,'Step 13 Requests '||token);
  insert into public.users(id,email,full_name,role,committee_id,is_active)
  values(m,token||'-m@example.test','Request Member','Member',c,true);
  perform set_config('ceit_connect.officer_writer','invite_new_officer',true);
  insert into public.users(id,email,full_name,role,committee_id,is_active)
  values(o,token||'-o@example.test','Request Co-Admin','Co-Admin',c,true);
  perform set_config('ceit_connect.officer_writer','',true);
  insert into public.events(id,name,start_date,end_date,status,created_by) values(e,token,current_date,current_date+1,'Active',o);
  perform set_config('ceit_connect.task_assignee_writer','create_event_with_tasks',true);
  perform set_config('ceit_connect.task_access_writer','create_active_event_task',true);
  insert into public.tasks(event_id,committee_id,title,phase,status,due_date,primary_assignees,request_backup,created_by,sort_order)
  select e,c,token||'-leave-'||n,'Requests','To Do',statement_timestamp()+interval '1 hour',array[m],false,o,n*1024 from generate_series(1,21)n;
  insert into public.tasks(event_id,committee_id,title,phase,status,due_date,primary_assignees,request_backup,created_by,sort_order)
  select e,c,token||'-volunteer-'||n,'Volunteer','To Do',statement_timestamp()+interval '1 day','{}'::uuid[],true,o,n*1024 from generate_series(1,21)n;
  insert into public.tasks(event_id,committee_id,title,phase,status,due_date,primary_assignees,request_backup,created_by,sort_order)
  values(e,c,token||'-officer-leave','Officer','To Do',now(),array[o],false,o,1024),
        (e,c,token||'-officer-help','Officer help','To Do',now(),'{}',true,o,2048);
  perform set_config('ceit_connect.task_access_writer','',true);
  perform set_config('ceit_connect.task_assignee_writer','',true);
  insert into public.task_leave_requests(task_id,requester_id)
  select id,m from public.tasks where title like token||'-leave-%' order by sort_order limit 19;
  insert into public.task_volunteers(task_id,user_id)
  select id,m from public.tasks where title like token||'-volunteer-%' order by sort_order limit 19;
  perform set_config('ceit_connect.test_member',m::text,true);
  perform set_config('ceit_connect.test_officer',o::text,true);
  perform set_config('ceit_connect.test_token',token,true);
  perform set_config('ceit_connect.test_volunteer_20',(
    select id::text from public.tasks where title=token||'-volunteer-20'),true);
  perform set_config('ceit_connect.test_volunteer_21',(
    select id::text from public.tasks where title=token||'-volunteer-21'),true);
  perform set_config('ceit_connect.test_officer_help',(
    select id::text from public.tasks where title=token||'-officer-help'),true);
end $$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('ceit_connect.test_member'),'role','authenticated')::text,true);
select * from public.unassign_self((select id from public.tasks where title=current_setting('ceit_connect.test_token')||'-leave-20'));
do $$ begin
  begin perform * from public.unassign_self((select id from public.tasks where title=current_setting('ceit_connect.test_token')||'-leave-21'));
  exception when sqlstate 'CCL20' then null; end;
  if (select count(*) from public.list_pending_task_leave_requests(null) where out_is_requester)<>20 then raise exception 'leave cap failed'; end if;
end $$;
select * from public.volunteer_for_task(current_setting('ceit_connect.test_volunteer_20')::uuid);
do $$ declare capped boolean:=false; begin
  begin perform * from public.volunteer_for_task(current_setting('ceit_connect.test_volunteer_21')::uuid);
  exception when sqlstate 'CCB20' then capped:=true; end;
  if not capped then raise exception 'volunteer cap failed'; end if;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('ceit_connect.test_officer'),'role','authenticated')::text,true);
select * from public.unassign_self((select id from public.tasks where title=current_setting('ceit_connect.test_token')||'-officer-leave'));
select * from public.volunteer_for_task(current_setting('ceit_connect.test_officer_help')::uuid);
do $$ declare no_offer boolean:=false; begin
  if exists(select 1 from public.list_pending_task_leave_requests(
      (select id from public.tasks where title=current_setting('ceit_connect.test_token')||'-officer-leave'))) then raise exception 'officer leave created request'; end if;
  begin
    perform * from public.withdraw_task_volunteer(current_setting('ceit_connect.test_officer_help')::uuid);
  exception when sqlstate 'CCB06' then no_offer:=true; end;
  if not no_offer then raise exception 'officer helper created offer'; end if;
  if not exists(select 1 from public.tasks where title=current_setting('ceit_connect.test_token')||'-officer-help' and auth.uid()=any(assist_assignees)) then raise exception 'officer helper missing'; end if;
  raise exception 'TEST RESULTS: STEP 13 LEAVE/VOLUNTEER 19/20/21 PASS';
end $$;
```

Serialized-loser supplement: for leave, start with 19 pending requests for one Member and race two different eligible `unassign_self` calls; exactly one commits as request 20 and the loser returns `CCL20`. For volunteers, start with 19 valid offers and race two different `volunteer_for_task` calls; exactly one commits as offer 20 and the loser returns `CCB20`. Run both arrival orders. The final count must be 20 with no duplicate/partial row. The SQL Editor must use two sessions/tabs; a single paste cannot prove blocking.

## Paste 4 — denied resolvers, confidential visibility, accept ordering

Expected result lines: **1** — `TEST RESULTS: STEP 13 AUTH/VISIBILITY/ACCEPT PASS`.

```sql
begin;
do $$
declare
  inactive_admin uuid:=gen_random_uuid(); inactive_member uuid:=gen_random_uuid();
  active_member uuid:=gen_random_uuid(); requester uuid:=gen_random_uuid(); volunteer uuid:=gen_random_uuid();
  creator_coadmin uuid:=gen_random_uuid(); other_coadmin uuid:=gen_random_uuid();
  committee_a uuid:=gen_random_uuid(); committee_b uuid:=gen_random_uuid(); committee_c uuid:=gen_random_uuid();
  event_id uuid:=gen_random_uuid(); leave_task uuid:=gen_random_uuid(); hidden_task uuid:=gen_random_uuid();
  accept_task uuid:=gen_random_uuid(); request_id uuid:=gen_random_uuid(); hidden_request_id uuid:=gen_random_uuid();
  token text:='step13-auth-'||gen_random_uuid(); actor uuid;
begin
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  select id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',token||'-'||label||'@example.test',
    crypt('Step13-test-1!',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('test_token',token||'-'||label),now(),now()
  from (values
    (inactive_admin,'inactive-admin'),(inactive_member,'inactive-member'),(active_member,'active-member'),
    (requester,'requester'),(volunteer,'volunteer'),(creator_coadmin,'creator-coadmin'),
    (other_coadmin,'other-coadmin')) fixture(id,label);
  insert into public.committees(id,name) values
    (committee_a,'Step 13 A '||token),(committee_b,'Step 13 B '||token),(committee_c,'Step 13 C '||token);
  perform set_config('ceit_connect.officer_writer','invite_new_officer',true);
  insert into public.users(id,email,full_name,role,committee_id,is_active) values
    (inactive_admin,token||'-inactive-admin@example.test','Inactive Admin','Admin',null,false),
    (creator_coadmin,token||'-creator-coadmin@example.test','Creator Co-Admin','Co-Admin',committee_a,true),
    (other_coadmin,token||'-other-coadmin@example.test','Other Co-Admin','Co-Admin',committee_c,true);
  perform set_config('ceit_connect.officer_writer','',true);
  insert into public.users(id,email,full_name,role,committee_id,is_active) values
    (inactive_member,token||'-inactive-member@example.test','Inactive Member','Member',committee_a,false),
    (active_member,token||'-active-member@example.test','Active Member','Member',committee_a,true),
    (requester,token||'-requester@example.test','Requester','Member',committee_a,true),
    (volunteer,token||'-volunteer@example.test','Volunteer','Member',committee_a,true);
  insert into public.events(id,name,start_date,end_date,status,created_by)
  values(event_id,token,current_date,current_date+1,'Active',creator_coadmin);
  perform set_config('ceit_connect.task_assignee_writer','create_event_with_tasks',true);
  perform set_config('ceit_connect.task_access_writer','create_active_event_task',true);
  insert into public.tasks(id,event_id,committee_id,title,phase,status,due_date,primary_assignees,
    request_backup,is_confidential,allowed_viewers,created_by,sort_order) values
    (leave_task,event_id,committee_a,token||'-leave','Auth','To Do',now(),array[requester],false,false,'{}',creator_coadmin,1024),
    (hidden_task,event_id,committee_b,token||'-hidden','Auth','To Do',now(),'{}',false,true,'{}',creator_coadmin,2048),
    (accept_task,event_id,committee_a,token||'-accept','Auth','To Do',now(),'{}',true,false,'{}',creator_coadmin,3072);
  perform set_config('ceit_connect.task_access_writer','',true);
  perform set_config('ceit_connect.task_assignee_writer','',true);
  insert into public.task_leave_requests(id,task_id,requester_id) values
    (request_id,leave_task,requester),(hidden_request_id,hidden_task,active_member);
  insert into public.task_volunteers(task_id,user_id) values(accept_task,volunteer);
  perform set_config('ceit_connect.test_inactive_admin',inactive_admin::text,true);
  perform set_config('ceit_connect.test_inactive_member',inactive_member::text,true);
  perform set_config('ceit_connect.test_active_member',active_member::text,true);
  perform set_config('ceit_connect.test_creator_coadmin',creator_coadmin::text,true);
  perform set_config('ceit_connect.test_other_coadmin',other_coadmin::text,true);
  perform set_config('ceit_connect.test_volunteer',volunteer::text,true);
  perform set_config('ceit_connect.test_request',request_id::text,true);
  perform set_config('ceit_connect.test_leave_task',leave_task::text,true);
  perform set_config('ceit_connect.test_hidden_request',hidden_request_id::text,true);
  perform set_config('ceit_connect.test_hidden_task',hidden_task::text,true);
  perform set_config('ceit_connect.test_accept_task',accept_task::text,true);
end $$;
set local role authenticated;
do $$
declare actor uuid; denied boolean; v_message text;
begin
  foreach actor in array array[
    current_setting('ceit_connect.test_inactive_admin')::uuid,
    current_setting('ceit_connect.test_inactive_member')::uuid,
    current_setting('ceit_connect.test_active_member')::uuid
  ] loop
    perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
    denied:=false;
    begin
      perform public.resolve_task_leave_request(current_setting('ceit_connect.test_request')::uuid,'denied');
    exception when sqlstate '42501' then denied:=true; end;
    if not denied then raise exception 'unauthorized resolver % succeeded',actor; end if;
  end loop;
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',current_setting('ceit_connect.test_creator_coadmin'),'role','authenticated')::text,true);
  if not exists(select 1 from public.list_pending_task_leave_requests(
      current_setting('ceit_connect.test_leave_task')::uuid)
      where out_id=current_setting('ceit_connect.test_request')::uuid) then
    raise exception 'unauthorized resolve changed request';
  end if;

  foreach actor in array array[
    current_setting('ceit_connect.test_creator_coadmin')::uuid,
    current_setting('ceit_connect.test_other_coadmin')::uuid,
    current_setting('ceit_connect.test_active_member')::uuid,
    current_setting('ceit_connect.test_inactive_admin')::uuid
  ] loop
    perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
    denied:=false; v_message:=null;
    begin
      perform * from public.set_task_confidentiality(current_setting('ceit_connect.test_hidden_task')::uuid,false,'{}');
    exception when sqlstate '42501' then
      denied:=true; get stacked diagnostics v_message=message_text;
    end;
    if not denied then raise exception 'unauthorized confidentiality caller % succeeded',actor; end if;
    if actor in (current_setting('ceit_connect.test_creator_coadmin')::uuid,
                 current_setting('ceit_connect.test_other_coadmin')::uuid)
       and v_message<>'You are not allowed to change this task''s confidentiality.' then
      raise exception 'confidential denial message drift';
    end if;
    if exists(select 1 from public.list_pending_task_leave_requests(
        current_setting('ceit_connect.test_hidden_task')::uuid)) then
      raise exception 'pending reader leaked a hidden request';
    end if;
    if actor in (current_setting('ceit_connect.test_creator_coadmin')::uuid,
                 current_setting('ceit_connect.test_other_coadmin')::uuid) then
      denied:=false;
      begin
        perform public.resolve_task_leave_request(
          current_setting('ceit_connect.test_hidden_request')::uuid,'denied');
      exception when sqlstate '42501' then denied:=true; end;
      if not denied then raise exception 'hidden request was resolvable'; end if;
    end if;
  end loop;

  actor:=current_setting('ceit_connect.test_creator_coadmin')::uuid;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  perform * from public.accept_task_volunteer(
    current_setting('ceit_connect.test_accept_task')::uuid,
    current_setting('ceit_connect.test_volunteer')::uuid);
  -- A successful guarded assignment proves the selected offer was deleted first:
  -- guard_task_assignee_writes rejects an added assignee with a pending offer.
  if not exists(select 1 from public.tasks
      where id=current_setting('ceit_connect.test_accept_task')::uuid
        and current_setting('ceit_connect.test_volunteer')::uuid=any(assist_assignees)) then
    raise exception 'accepted volunteer missing from assist assignees';
  end if;
  raise exception 'TEST RESULTS: STEP 13 AUTH/VISIBILITY/ACCEPT PASS';
end $$;
```

## Required retained regressions

Re-run the existing Phase 4 Step 5B, 7, 7A, 8, 9A, Step 10, and Batch 11 suites after applying the migration. In focused Step 13 verification also cover: Completed leave freeze for every role; null/>72-hour Member immediate leave; exact/inside 72-hour request; requester cancel; no self approval; approve/deny; stale cancellation reasons; task-delete cascade; only pending reader output; zero activity/notification rows for request-only changes; actor candidate exclusion with stored-chip retention; stored-state “already present” rejection; raw confidential/viewer INSERT/UPDATE rejection; Draft/Active/Archived and To Do/In Progress/Completed raw deletes; definer task deletion and event cascade; launch/archive/delete while at or over the Draft cap; access marker cleanup on success and exception; and safe `CCD01` UI copy.
