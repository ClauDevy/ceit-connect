# Task creation dependencies

Migration: `20261130120000_task_creation_dependencies.sql` (later than the branch tip `20261129120000`).

The three new public writers delegate to the latest existing public writer chain. Existing function definitions and grants are unchanged. New tasks receive their dependency before INSERT, so each receives one `task_created` entry and no `task_updated` / `Dependency updated` entry. A dependency-only change on an existing task produces the established one `task_updated` entry with `dependency` in `changed_fields`; if the same save also changes other task content, the delegated content update and dependency update remain separate activity rows. An absent field does nothing and explicit null clears it.

The event form topologically orders Edit Event additions by `dependsOnClientKey` before sending `p_tasks_to_add`. Create Event sends its original form order: the additive database wrapper captures canonical phase order by first JSON ordinality, topologically orders only its internal insertion plan, calls the unchanged old writer, then locks the event row, takes the dependency advisory lock, and reapplies the captured phase order through `reconcile_event_phase_positions`. A missing prerequisite or client-side cycle is stopped with the fixed message `Review the selected task prerequisites and try again.` Database errors continue through fixed error mapping and are never displayed raw.

`validate_task_dependency` remains the final trigger boundary for prerequisite existence, same-event enforcement, self-dependency, and cycle rejection. The new helper independently checks active leadership, Draft/Active lifecycle, same-event membership, NULL-safe real-or-masked prerequisite visibility, and the completed-phase rule before creation; the existing completed-phase trigger rechecks the latter during INSERT. For existing dependents, `set_task_dependency` continues to supply real-dependent visibility, row locking/rechecks, same-event/no-self/no-cycle validation, and exact-row enforcement. Masked dependency-choice rows return a null `out_depends_on_task_id`.

`set_task_dependency` and the task triggers update only `public.tasks`; they do not update `public.events.updated_at`. The old Edit Event writer updates the event last and returns that new timestamp, and dependency changes applied afterward therefore do not make it stale. Likewise, an explicit clear before the old writer does not change the event token, so the original expected timestamp remains valid.

The old physical Edit Event writer executes `foreach v_delete_id in array p_task_ids_to_delete`, followed by `delete from public.tasks where id = v_delete_id and event_id = p_event_id`. The additive wrapper computes each requested task's maximum dependent depth and sorts ascending: dependents with no requested children have depth zero and are placed first, while their prerequisites have larger depths and are placed later. The unchanged old loop therefore deletes every requested dependent before its requested prerequisite.

Every public wrapper clears the transaction-local plan, index, and key map after success and from its outer exception handler. In these postgres-owned definer chains `current_user` is always `postgres`, so the trigger's `current_user` check is not an authorization boundary; the non-empty transaction-local plan is the actual activation condition.

Archived-template creation is deliberately deferred and unchanged.

## Owner-run Dev verification

Expected result count: **19/19**. Labels:

1. `non-Admin creation denied`
2. `ordinary create succeeds`
3. `temporary key resolves`
4. `phase order preserved with cross-phase dependency`
5. `cross phase dependency allowed`
6. `created tasks have creation activity only`
7. `absent dependency is unchanged`
8. `explicit null clears`
9. `dependency-only edit logs once and returns current version`
10. `dependency cycle rejected`
11. `confidential choice is masked and hides dependency id`
12. `board add dependency succeeds`
13. `cross event rejected`
14. `prerequisite and dependent delete together`
15. `later temporary task rejected`
16. `completed phase addition rejected`
17. `old writers remain`
18. `template writer unchanged`
19. `no new event task foreign key`

Run the following as one SQL Editor paste. It creates a normal results table inside the transaction, owns all fixtures, runs without RLS while using authenticated JWT claims for real RPC authorization, and always rolls back through the final exception.

```sql
-- Run without RLS. Expected result count: 19/19.
begin;

create table public.task_dependency_test_results (
  label text primary key,
  passed boolean not null,
  detail text not null
);

do $$
declare
  v_admin uuid := 'd1000000-0000-4000-8000-000000000001';
  v_coadmin uuid := 'd1000000-0000-4000-8000-000000000002';
  v_member uuid := 'd1000000-0000-4000-8000-000000000003';
  v_committee uuid := 'd100c000-0000-4000-8000-000000000001';
  v_other_committee uuid := 'd100c000-0000-4000-8000-000000000002';
  v_event uuid;
  v_phase_event uuid;
  v_other_event uuid;
  v_complete_event uuid;
  v_first uuid;
  v_second uuid;
  v_other_task uuid;
  v_complete_task uuid;
  v_board uuid;
  v_version timestamptz;
  v_returned_version timestamptz;
  v_created_count integer;
  v_updated_before integer;
  v_updated_after integer;
  v_masked_label text;
  v_masked_dependency uuid;
begin
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
    (v_admin,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','dependency-admin@example.invalid','',now(),'{}','{}',now(),now()),
    (v_coadmin,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','dependency-coadmin@example.invalid','',now(),'{}','{}',now(),now()),
    (v_member,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','dependency-member@example.invalid','',now(),'{}','{}',now(),now());
  insert into public.committees(id,name) values
    (v_committee,'Dependency Test Committee'),
    (v_other_committee,'Dependency Other Committee');

  perform pg_catalog.set_config('ceit_connect.officer_writer','invite_new_officer',true);
  insert into public.users(id,email,full_name,role,committee_id,is_active) values
    (v_admin,'dependency-admin@example.invalid','Dependency Test Admin','Admin',null,true),
    (v_coadmin,'dependency-coadmin@example.invalid','Dependency Test Co-Admin','Co-Admin',v_other_committee,true);
  perform pg_catalog.set_config('ceit_connect.officer_writer','',true);
  insert into public.users(id,email,full_name,role,committee_id,is_active)
  values(v_member,'dependency-member@example.invalid','Dependency Test Member','Member',v_committee,true);

  perform pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object('sub',v_member,'role','authenticated')::text,true);
  begin
    perform public.create_event_with_task_dependencies('Denied Event',null,current_date,current_date+1,'Draft','[]');
    insert into public.task_dependency_test_results values('non-Admin creation denied',false,'unexpected success');
  exception when others then
    insert into public.task_dependency_test_results values('non-Admin creation denied',sqlerrm='Only an active Admin or Co-Admin can create task dependencies.',sqlerrm);
  end;

  perform pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object('sub',v_admin,'role','authenticated')::text,true);
  begin
    v_event := public.create_event_with_task_dependencies(
      'Dependency Test Event',null,current_date,current_date+1,'Draft',
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('client_key','d1000000-0000-4000-8000-000000000011','title','First','description',null,'phase','Planning','committee_id',v_committee,'task_type','Deliverable','due_date',null,'call_time',null,'end_time',null,'priority','Medium','assignee_ids','[]'::jsonb,'depends_on_task_id',null,'depends_on_client_key',null),
        pg_catalog.jsonb_build_object('client_key','d1000000-0000-4000-8000-000000000012','title','Second','description',null,'phase','Delivery','committee_id',v_committee,'task_type','Deliverable','due_date',null,'call_time',null,'end_time',null,'priority','Medium','assignee_ids','[]'::jsonb,'depends_on_task_id',null,'depends_on_client_key','d1000000-0000-4000-8000-000000000011')
      )
    );
    insert into public.task_dependency_test_results values('ordinary create succeeds',v_event is not null,'event='||coalesce(v_event::text,'null'));
  exception when others then
    insert into public.task_dependency_test_results values('ordinary create succeeds',false,sqlstate||' '||sqlerrm);
  end;

  v_phase_event := public.create_event_with_task_dependencies(
    'Phase Order Event',null,current_date,current_date+1,'Draft',
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('client_key','d1000000-0000-4000-8000-000000000051','title','Planning dependent','description',null,'phase','Planning','committee_id',v_committee,'task_type','Deliverable','due_date',null,'call_time',null,'end_time',null,'priority','Medium','assignee_ids','[]'::jsonb,'depends_on_client_key','d1000000-0000-4000-8000-000000000052'),
      pg_catalog.jsonb_build_object('client_key','d1000000-0000-4000-8000-000000000052','title','Delivery prerequisite','description',null,'phase','Delivery','committee_id',v_committee,'task_type','Deliverable','due_date',null,'call_time',null,'end_time',null,'priority','Medium','assignee_ids','[]'::jsonb)
    )
  );
  insert into public.task_dependency_test_results values(
    'phase order preserved with cross-phase dependency',
    (select pg_catalog.array_agg(phase_key order by position) from ceit_connect_private.event_phase_positions where event_id=v_phase_event)=array['Planning','Delivery']::text[],
    coalesce((select pg_catalog.array_agg(phase_key order by position)::text from ceit_connect_private.event_phase_positions where event_id=v_phase_event),'missing')
  );

  select id into v_first from public.tasks where event_id=v_event and title='First';
  select id into v_second from public.tasks where event_id=v_event and title='Second';
  insert into public.task_dependency_test_results values('temporary key resolves',(select depends_on_task_id from public.tasks where id=v_second)=v_first,coalesce((select depends_on_task_id::text from public.tasks where id=v_second),'null'));
  insert into public.task_dependency_test_results values('cross phase dependency allowed',(select phase from public.tasks where id=v_first) is distinct from (select phase from public.tasks where id=v_second),'different phases');

  select count(*) into v_created_count from public.activity_log where task_id in(v_first,v_second) and activity_type='task_created';
  insert into public.task_dependency_test_results values('created tasks have creation activity only',v_created_count=2 and not exists(select 1 from public.activity_log where task_id in(v_first,v_second) and activity_type='task_updated'),'created='||v_created_count);

  select updated_at into v_version from public.events where id=v_event;
  perform public.edit_event_with_task_dependencies(v_event,v_version,'Dependency Test Event',null,current_date,current_date+1,'Draft','[]','[]','{}','[]');
  insert into public.task_dependency_test_results values('absent dependency is unchanged',(select depends_on_task_id from public.tasks where id=v_second)=v_first,'dependency retained');

  select updated_at into v_version from public.events where id=v_event;
  perform public.edit_event_with_task_dependencies(v_event,v_version,'Dependency Test Event',null,current_date,current_date+1,'Draft','[]',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',v_second,'title','Second','description',null,'phase','Delivery','committee_id',v_committee,'task_type','Deliverable','due_date',null,'call_time',null,'end_time',null,'priority','Medium','assignee_ids','[]'::jsonb,'depends_on_task_id',null)),'{}','[]');
  insert into public.task_dependency_test_results values('explicit null clears',(select depends_on_task_id from public.tasks where id=v_second) is null,'dependency cleared');

  select count(*) into v_updated_before from public.activity_log where task_id=v_second and activity_type='task_updated';
  select updated_at into v_version from public.events where id=v_event;
  v_returned_version := public.edit_event_with_task_dependencies(v_event,v_version,'Dependency Test Event',null,current_date,current_date+1,'Draft','[]',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',v_second,'title','Second','description',null,'phase','Delivery','committee_id',v_committee,'task_type','Deliverable','due_date',null,'call_time',null,'end_time',null,'priority','Medium','assignee_ids','[]'::jsonb,'depends_on_task_id',v_first)),'{}','[]');
  select count(*) into v_updated_after from public.activity_log where task_id=v_second and activity_type='task_updated';
  insert into public.task_dependency_test_results values('dependency-only edit logs once and returns current version',(select depends_on_task_id from public.tasks where id=v_second)=v_first and v_updated_after=v_updated_before+1 and v_returned_version=(select updated_at from public.events where id=v_event),'before='||v_updated_before||', after='||v_updated_after);

  select updated_at into v_version from public.events where id=v_event;
  begin
    perform public.edit_event_with_task_dependencies(v_event,v_version,'Dependency Test Event',null,current_date,current_date+1,'Draft','[]',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',v_first,'title','First','description',null,'phase','Planning','committee_id',v_committee,'task_type','Deliverable','due_date',null,'call_time',null,'end_time',null,'priority','Medium','assignee_ids','[]'::jsonb,'depends_on_task_id',v_second)),'{}','[]');
    insert into public.task_dependency_test_results values('dependency cycle rejected',false,'unexpected success');
  exception when others then
    insert into public.task_dependency_test_results values('dependency cycle rejected',sqlerrm='This dependency would create a cycle.',sqlerrm);
  end;

  perform public.set_task_confidentiality(v_second,true,'{}');
  perform pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object('sub',v_coadmin,'role','authenticated')::text,true);
  select out_label,out_depends_on_task_id into v_masked_label,v_masked_dependency
  from public.list_event_task_dependency_choices(v_event) where out_task_id=v_second;
  insert into public.task_dependency_test_results values('confidential choice is masked and hides dependency id',v_masked_label='Confidential Task' and v_masked_dependency is null,coalesce(v_masked_label,'missing'));
  perform pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object('sub',v_admin,'role','authenticated')::text,true);

  v_other_event := public.create_event_with_task_dependencies('Other Dependency Event',null,current_date,current_date+1,'Active',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('client_key','d1000000-0000-4000-8000-000000000021','title','Other','description',null,'phase','Planning','committee_id',v_committee,'task_type','Deliverable','due_date',null,'call_time',null,'end_time',null,'priority','Medium','assignee_ids','[]'::jsonb)));
  select id into v_other_task from public.tasks where event_id=v_other_event and title='Other';
  select out_task_id into v_board from public.create_active_event_task_with_dependency(v_other_event,'Board dependent',null,'Delivery',v_committee,'Deliverable','Medium',null,null,null,'{}',false,'{}',v_other_task);
  insert into public.task_dependency_test_results values('board add dependency succeeds',(select depends_on_task_id from public.tasks where id=v_board)=v_other_task and (select count(*) from public.activity_log where task_id=v_board and activity_type='task_created')=1 and (select count(*) from public.activity_log where task_id=v_board and activity_type='task_updated')=0,'dependency and activity verified');

  select updated_at into v_version from public.events where id=v_event;
  begin
    perform public.edit_event_with_task_dependencies(v_event,v_version,'Dependency Test Event',null,current_date,current_date+1,'Draft','[]',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',v_second,'title','Second','description',null,'phase','Delivery','committee_id',v_committee,'task_type','Deliverable','due_date',null,'call_time',null,'end_time',null,'priority','Medium','assignee_ids','[]'::jsonb,'depends_on_task_id',v_other_task)),'{}','[]');
    insert into public.task_dependency_test_results values('cross event rejected',false,'unexpected success');
  exception when others then
    insert into public.task_dependency_test_results values('cross event rejected',sqlerrm='A task can depend only on another task in the same event.',sqlerrm);
  end;

  select updated_at into v_version from public.events where id=v_event;
  perform public.edit_event_with_task_dependencies(v_event,v_version,'Dependency Test Event',null,current_date,current_date+1,'Draft','[]','[]',array[v_first,v_second],'[]');
  insert into public.task_dependency_test_results values('prerequisite and dependent delete together',not exists(select 1 from public.tasks where id in(v_first,v_second)),'both removed');

  select updated_at into v_version from public.events where id=v_event;
  begin
    perform public.edit_event_with_task_dependencies(v_event,v_version,'Dependency Test Event',null,current_date,current_date+1,'Draft',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('client_key','d1000000-0000-4000-8000-000000000031','title','Forward','description',null,'phase','Planning','committee_id',v_committee,'task_type','Deliverable','due_date',null,'call_time',null,'end_time',null,'priority','Medium','assignee_ids','[]'::jsonb,'depends_on_client_key','d1000000-0000-4000-8000-000000000032'),
      pg_catalog.jsonb_build_object('client_key','d1000000-0000-4000-8000-000000000032','title','Later','description',null,'phase','Planning','committee_id',v_committee,'task_type','Deliverable','due_date',null,'call_time',null,'end_time',null,'priority','Medium','assignee_ids','[]'::jsonb)
    ),'[]','{}','[]');
    insert into public.task_dependency_test_results values('later temporary task rejected',false,'unexpected success');
  exception when others then
    insert into public.task_dependency_test_results values('later temporary task rejected',sqlerrm='A temporary prerequisite must be a task added earlier in this form.',sqlerrm);
  end;

  v_complete_event := public.create_event_with_task_dependencies('Complete Phase Event',null,current_date,current_date+1,'Draft',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('client_key','d1000000-0000-4000-8000-000000000041','title','Complete me','description',null,'phase','Complete','committee_id',v_committee,'task_type','Deliverable','due_date',null,'call_time',null,'end_time',null,'priority','Medium','assignee_ids','[]'::jsonb)));
  select id into v_complete_task from public.tasks where event_id=v_complete_event;
  perform public.move_task(v_complete_task,'Complete','To Do','Completed',null,null);
  select updated_at into v_version from public.events where id=v_complete_event;
  begin
    perform public.edit_event_with_task_dependencies(v_complete_event,v_version,'Complete Phase Event',null,current_date,current_date+1,'Draft',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('client_key','d1000000-0000-4000-8000-000000000042','title','Blocked addition','description',null,'phase','Complete','committee_id',v_committee,'task_type','Deliverable','due_date',null,'call_time',null,'end_time',null,'priority','Medium','assignee_ids','[]'::jsonb)),'[]','{}','[]');
    insert into public.task_dependency_test_results values('completed phase addition rejected',false,'unexpected success');
  exception when others then
    insert into public.task_dependency_test_results values('completed phase addition rejected',sqlerrm='This phase is complete and read-only.',sqlerrm);
  end;

  insert into public.task_dependency_test_results values('old writers remain',(to_regprocedure('public.create_event_with_tasks(text,text,date,date,text,jsonb)') is not null and to_regprocedure('public.edit_event_with_tasks(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[],jsonb)') is not null),'catalog present');
  insert into public.task_dependency_test_results values('template writer unchanged',to_regprocedure('public.create_event_from_archived_template(text,text,date,date,text,uuid,jsonb,jsonb)') is not null,'catalog present');
  insert into public.task_dependency_test_results values('no new event task foreign key',(select count(*)=1 from pg_constraint c join pg_class r on r.oid=c.conrelid join pg_namespace rn on rn.oid=r.relnamespace join pg_class f on f.oid=c.confrelid join pg_namespace fn on fn.oid=f.relnamespace where c.contype='f' and rn.nspname='public' and fn.nspname='public' and r.relname='tasks' and f.relname='tasks' and c.conname='tasks_depends_on_task_id_fkey'),'only the original depends_on_task_id self-reference remains');
end
$$;

select label,passed,detail from public.task_dependency_test_results order by label;

do $$
declare v_total integer; v_passed integer; v_failed text;
begin
  select count(*),count(*) filter(where passed),string_agg(label,', ' order by label) filter(where not passed)
  into v_total,v_passed,v_failed from public.task_dependency_test_results;
  if v_total=19 and v_passed=19 then
    raise exception 'TEST RESULTS 19/19 PASS (intentional rollback)';
  end if;
  raise exception 'TEST RESULTS %/% PASS; FAILED: % (intentional rollback)',v_passed,v_total,coalesce(v_failed,'result count mismatch');
end
$$;
```
