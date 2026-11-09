# Step 14 database verification and authoritative A/B/D catalog

> **Phase 5 N1 successor note:** this already-passed paste is frozen. Its
> notification CRUD expectation is historical and must not be rerun after N1.
> The current notification allowlist and grant/policy checks move to
> `docs/phase-5/catalog.md` and the 30-line N1 Paste A.
>
> **Phase 5 N3a successor note:** this already-passed paste remains frozen.
> N3a preserves the N1 table/policy boundary and adds its source-bound objects
> to `docs/phase-5/catalog.md`; the 38-line N3a Paste A owns current catalog,
> grant, private-history, and runner assertions.

Run order on Dev: apply `20261109120000_batch_14_privilege_and_run_history_hardening.sql`, then `20261109121000_batch_14_inactive_event_visibility.sql`, then `20261109122000_enable_officer_role_caps.sql`; run this paste; then re-run `step-8-tests.md`, `step-a-tests.md`, `step-b-tests.md`, and `step-d-tests.md`. Review every migration before applying it. The paste is one transaction, creates its fixtures inside that transaction, impersonates browser callers, prints exactly **33** result lines, and ends with the intentional `TEST RESULTS` exception that rolls everything back.

No new global catalog total is claimed here. The owner records totals only from this live Dev run. The allowlist below is source-bound: an object is accepted only when its tracked source migration is present.

The 33-line Part 1 paste below is frozen because it already passed on Dev. Batch 14 Part 2 adds the fourth Batch 14 migration and its function to this migration-tied allowlist, while `step-14-part-2-tests.md` owns the new function's catalog and behavior checks.

## Migration-tied allowlist

| Source migration | Exact catalog entries absorbed by Step 10 |
| --- | --- |
| `20261106120000_event_phase_positions.sql` | table `ceit_connect_private.event_phase_positions`; PK, `(event_id, position)` unique constraint and `event_id -> events(id) ON DELETE CASCADE` FK; functions `reconcile_event_phase_positions(uuid,text[])`, `defer_event_phase_reconciliation()`, `list_event_phase_order(uuid)`, current and revoked `list_draft_event_editor_tasks[_pre_batch_a](uuid)`, current and revoked `list_event_board_tasks[_pre_batch_a](uuid,uuid)`, current and revoked `edit_event_with_tasks[_pre_batch_a](uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[],jsonb)`, current and revoked `create_event_with_tasks[_pre_batch_a](text,text,date,date,text,jsonb)`, current and revoked `create_event_from_archived_template[_pre_batch_a](text,text,date,date,text,uuid,jsonb,jsonb)`, current and revoked `get_archived_event_template[_pre_batch_a](uuid,date)`, and `list_home_event_progress(uuid[])`; deferred constraint trigger `tasks_z9_reconcile_event_phase_positions`. |
| `20261106130000_peer_admin_lifecycle.sql` | replacements `former_member_eligibility(uuid)`, `set_officer_active(uuid,boolean)`, `anonymize_former_member(uuid)` and new `get_admin_lifecycle_context()`. |
| `20261106140000_event_deadline_bounds.sql` | private functions `schedule_after_event_end(timestamptz,date)`, `guard_task_event_end()`, `guard_event_end_shortening()`; triggers `tasks_i0_guard_event_end` and `events_z0_guard_end_shortening`. |
| `20261106150000_activity_log_subjects.sql` | private table `activity_type_catalog`; exact rows `event_created`, `event_created_from_template`, `event_edited`, `event_launched`, `event_archived`, `event_deleted`, `phase_added`, `phase_renamed`, `phase_moved`, `phase_removed`, `task_created`, `task_updated`, `task_deleted`, `task_assigned`, `task_unassigned`, `task_left`, `task_leave_requested`, `task_leave_approved`, `task_leave_rejected`, `task_leave_cancelled`, `task_backup_requested`, `task_backup_cancelled`, `task_volunteered`, `task_status_changed`, `task_confidentiality_changed`, `member_invited`, `officer_invited`, `invitation_cancelled`, `officer_added`, `person_deactivated`, `person_reactivated`, `person_removed`, `committee_changed`, `appointed_coadmin`, `appointed_admin`, `returned_to_member`, `admin_stepped_down`, `bulk_events_deleted`, `bulk_members_removed`; reserved `system` actor shape; added `activity_log` columns `actor_kind`, `subject_kind`, `activity_type`, `event_id`, `subject_user_id`, `task_was_confidential`, `task_title_snapshot`; exact constraints `activity_log_actor_kind_check`, `activity_log_actor_shape_check`, `activity_log_semantic_shape_check`, `activity_log_activity_type_shape_fkey`, `activity_log_subject_ids_check`, `activity_log_task_confidentiality_check`, `activity_log_task_title_snapshot_check`, `activity_log_event_phase_payload_check`, `activity_log_event_name_snapshot_check`, `activity_log_bulk_payload_check`, `activity_log_assignment_payload_check`, `activity_log_leave_requester_payload_check`, `activity_log_person_payload_check`; private mirror `activity_event_status_visible_for_user(text,uuid)` and replacement `list_activity_log(uuid,text,text,uuid,date,date,text,timestamptz,uuid,integer)`. |
| `20261106160000_activity_log_trigger_writers.sql` | private `write_activity(text,text,uuid,uuid,uuid,uuid,boolean,text,jsonb)` plus `log_task_leave_activity()`, `log_task_volunteer_activity()`, `log_user_lifecycle_activity()`, `log_officer_invite_activity()`; replacement `log_task_activity()`; triggers `task_leave_requests_z9_activity_log`, `task_volunteers_z9_activity_log`, `users_z9_activity_log`, `officer_invites_z9_activity_log`. |
| `20261106170000_activity_log_event_writers.sql` | current and revoked `create_event_with_tasks[_pre_batch_b]`, `create_event_from_archived_template[_pre_batch_b]`, `edit_event_with_tasks[_pre_batch_b]`; current `archive_event(uuid,bigint,timestamptz)` wrapping revoked `archive_event_pre_batch_b`; private `event_delete_audit_snapshot(uuid,uuid)`; current and revoked `delete_event[_pre_batch_b](uuid,uuid,timestamptz)`; `delete_events_bulk(jsonb,uuid)` and `finalize_former_member_bulk_activity(uuid[])`. |
| `20261107120000_event_phase_delete_lock_inventory.sql` | expanded `event_delete_fk_lock_list_lock_kind_check`; exact `event_phase_positions.event_id -> events.id` inventory row with lock kind `event_child_rows`; replacement `lock_event_delete_descendants(uuid)`. |
| `20261108120000_event_auto_archive.sql` | `events.archived_unfinished_task_count` plus `events_archived_unfinished_task_count_nonnegative` and `_lifecycle`; private `capture_event_archive_snapshot()` and trigger `events_y0_capture_archive_snapshot`; replacement `guard_event_updates()`; private table `event_auto_archive_runs` with exactly 13 columns, one PK plus ten inline/named checks (11 constraints total), and index `event_auto_archive_runs_finished_at_id_idx`; private table `event_auto_archive_run_items` with exactly seven columns, one FK, one PK and five checks (seven constraints total); functions `event_auto_archive_grace_days()`, `event_auto_archive_run_retention_days()`, private `event_auto_archive_warning_values(date,date)`, `get_event_auto_archive_warning(uuid)`, private `auto_archive_one_event(uuid,date)`, private `purge_event_auto_archive_runs()`, and `run_event_auto_archive()`; catalog row `event_auto_archived` with `actor_kind = system`. |
| `20261109123000_revoke_inactive_user_sessions.sql` | `public.revoke_inactive_user_sessions(uuid)`; owner `postgres`; volatile; `SECURITY DEFINER`; fixed empty `search_path`; `EXECUTE` granted only to `service_role` and denied to `PUBLIC`, `anon`, and `authenticated`; no overloads. |

The prompt's minimum list was correct except for one wording detail: `system` is a reserved `activity_log.actor_kind`, not a column on `activity_type_catalog`; Batch D adds the `event_auto_archived` catalog row and writes it with that reserved actor kind. The migration scan additionally found the Batch A wrappers/readers and peer/deadline functions, Batch B activity columns/constraints/triggers and all other wrapped event writers, and Batch D table constraints/index. For completeness, `event_phase_positions` has exactly five constraints from its source: generated event FK, `(event_id,phase_key)` PK, `event_phase_positions_position_positive`, `event_phase_positions_canonical`, and `event_phase_positions_event_position_key`. The external `pg_cron` job is deliberately excluded from this catalog.

## One self-contained Dev paste

```sql
begin;
set local timezone = 'Asia/Manila';
set local statement_timeout = '120s';

create table batch_14_results (
  ordinal integer generated always as identity,
  test_name text not null,
  passed boolean not null,
  detail text not null
);

-- Catalog and grants. These first assertions require the SQL Editor's postgres session.
insert into batch_14_results(test_name,passed,detail)
select '01 exact authenticated table privileges', bool_and(actual = expected), string_agg(table_name||'='||actual, '; ' order by table_name)
from (
  select table_name, expected,
    concat_ws(',',
      case when has_table_privilege('authenticated',format('public.%I',table_name),'SELECT') then 'SELECT' end,
      case when has_table_privilege('authenticated',format('public.%I',table_name),'INSERT') then 'INSERT' end,
      case when has_table_privilege('authenticated',format('public.%I',table_name),'UPDATE') then 'UPDATE' end,
      case when has_table_privilege('authenticated',format('public.%I',table_name),'DELETE') then 'DELETE' end,
      case when has_table_privilege('authenticated',format('public.%I',table_name),'TRUNCATE') then 'TRUNCATE' end,
      case when has_table_privilege('authenticated',format('public.%I',table_name),'REFERENCES') then 'REFERENCES' end,
      case when has_table_privilege('authenticated',format('public.%I',table_name),'TRIGGER') then 'TRIGGER' end) actual
  from (values ('events','SELECT,INSERT,UPDATE'),('tasks','SELECT,INSERT,UPDATE,DELETE'),('notifications','SELECT,INSERT,UPDATE,DELETE'),('users','SELECT'),('activity_log','')) v(table_name,expected)
) s;
insert into batch_14_results(test_name,passed,detail) select '02 public RLS retained',count(*)=5,count(*)::text from pg_class where oid=any(array['public.events'::regclass,'public.tasks'::regclass,'public.notifications'::regclass,'public.users'::regclass,'public.activity_log'::regclass]) and relrowsecurity;
insert into batch_14_results(test_name,passed,detail) select '03 private run tables RLS on, not forced',count(*) filter(where relrowsecurity and not relforcerowsecurity)=2,count(*)::text from pg_class where oid=any(array['ceit_connect_private.event_auto_archive_runs'::regclass,'ceit_connect_private.event_auto_archive_run_items'::regclass]);
insert into batch_14_results(test_name,passed,detail) select '04 private run tables have zero policies',count(*)=0,count(*)::text from pg_policy where polrelid=any(array['ceit_connect_private.event_auto_archive_runs'::regclass,'ceit_connect_private.event_auto_archive_run_items'::regclass]);
insert into batch_14_results(test_name,passed,detail) select '05 anon has zero private run-table access',not bool_or(has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')),count(*)::text from pg_class where oid=any(array['ceit_connect_private.event_auto_archive_runs'::regclass,'ceit_connect_private.event_auto_archive_run_items'::regclass]);
insert into batch_14_results(test_name,passed,detail) select '06 authenticated has zero private run-table access',not bool_or(has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')),count(*)::text from pg_class where oid=any(array['ceit_connect_private.event_auto_archive_runs'::regclass,'ceit_connect_private.event_auto_archive_run_items'::regclass]);
insert into batch_14_results(test_name,passed,detail) select '07 service_role has zero private run-table access',not bool_or(has_table_privilege('service_role',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')),count(*)::text from pg_class where oid=any(array['ceit_connect_private.event_auto_archive_runs'::regclass,'ceit_connect_private.event_auto_archive_run_items'::regclass]);
insert into batch_14_results(test_name,passed,detail) select '08 warning is sole new authenticated executable',has_function_privilege('authenticated','public.get_event_auto_archive_warning(uuid)','EXECUTE') and not has_function_privilege('authenticated','public.event_auto_archive_grace_days()','EXECUTE') and not has_function_privilege('authenticated','public.event_auto_archive_run_retention_days()','EXECUTE'),'checked';
insert into batch_14_results(test_name,passed,detail) select '09 runner owner-only',p.proowner='postgres'::regrole and not has_function_privilege('anon',p.oid,'EXECUTE') and not has_function_privilege('authenticated',p.oid,'EXECUTE') and not has_function_privilege('service_role',p.oid,'EXECUTE'),p.proowner::regrole::text from pg_proc p where p.oid='public.run_event_auto_archive()'::regprocedure;
insert into batch_14_results(test_name,passed,detail) select '10 caps singleton enabled',count(*)=1 and bool_and(enforce_officer_role_caps),count(*)::text from public.app_settings where key='global';
insert into batch_14_results(test_name,passed,detail) select '11 events_select inactive-safe latest',count(*)=1 and bool_and(pg_get_expr(polqual,polrelid) like '%my_role() IS NOT NULL%'),count(*)::text from pg_policy where polrelid='public.events'::regclass and polname='events_select' and polcmd='r' and polroles=array['authenticated'::regrole::oid];
insert into batch_14_results(test_name,passed,detail) select '12 activity visibility mirror reconciled',pg_get_functiondef('ceit_connect_private.activity_event_status_visible_for_user(text,uuid)'::regprocedure) like '%profile.is_active%' and obj_description('ceit_connect_private.activity_event_status_visible_for_user(text,uuid)'::regprocedure,'pg_proc') like '%Mirrors effective events_select exactly%','checked';
insert into batch_14_results(test_name,passed,detail) select '13 Batch A table, FK and CCE09 row',to_regclass('ceit_connect_private.event_phase_positions') is not null and exists(select 1 from pg_constraint where conrelid='ceit_connect_private.event_phase_positions'::regclass and conname='event_phase_positions_event_id_fkey' and contype='f' and confrelid='public.events'::regclass) and exists(select 1 from ceit_connect_private.event_delete_fk_lock_list where constraint_name='event_phase_positions_event_id_fkey' and referencing_schema='ceit_connect_private' and referencing_table='event_phase_positions' and referenced_table='events' and lock_kind='event_child_rows' and lock_order=90),'checked';
insert into batch_14_results(test_name,passed,detail) select '14 Batch A phase functions and trigger',to_regprocedure('ceit_connect_private.reconcile_event_phase_positions(uuid,text[])') is not null and to_regprocedure('ceit_connect_private.defer_event_phase_reconciliation()') is not null and to_regprocedure('public.list_event_phase_order(uuid)') is not null and exists(select 1 from pg_trigger where tgrelid='public.tasks'::regclass and tgname='tasks_z9_reconcile_event_phase_positions'),'checked';
insert into batch_14_results(test_name,passed,detail) select '15 Batch A lifecycle functions',to_regprocedure('public.former_member_eligibility(uuid)') is not null and to_regprocedure('public.set_officer_active(uuid,boolean)') is not null and to_regprocedure('public.anonymize_former_member(uuid)') is not null and to_regprocedure('public.get_admin_lifecycle_context()') is not null,'checked';
insert into batch_14_results(test_name,passed,detail) select '16 Batch A deadline functions and triggers',to_regprocedure('ceit_connect_private.schedule_after_event_end(timestamptz,date)') is not null and to_regprocedure('ceit_connect_private.guard_task_event_end()') is not null and to_regprocedure('ceit_connect_private.guard_event_end_shortening()') is not null and (select count(*)=2 from pg_trigger where tgname=any(array['tasks_i0_guard_event_end','events_z0_guard_end_shortening']) and not tgisinternal),'checked';
insert into batch_14_results(test_name,passed,detail) select '17 Batch B/D exact activity-type allowlist',array_agg(activity_type order by activity_type)=array(select unnest(array['event_created','event_created_from_template','event_edited','event_launched','event_archived','event_deleted','phase_added','phase_renamed','phase_moved','phase_removed','task_created','task_updated','task_deleted','task_assigned','task_unassigned','task_left','task_leave_requested','task_leave_approved','task_leave_rejected','task_leave_cancelled','task_backup_requested','task_backup_cancelled','task_volunteered','task_status_changed','task_confidentiality_changed','member_invited','officer_invited','invitation_cancelled','officer_added','person_deactivated','person_reactivated','person_removed','committee_changed','appointed_coadmin','appointed_admin','returned_to_member','admin_stepped_down','bulk_events_deleted','bulk_members_removed','event_auto_archived']) order by 1),count(*)::text from ceit_connect_private.activity_type_catalog;
insert into batch_14_results(test_name,passed,detail) select '18 Batch B reserved system actor and D row',exists(select 1 from ceit_connect_private.activity_type_catalog where activity_type='event_auto_archived' and broad_action='UPDATE' and subject_kind='event' and audience='leadership') and exists(select 1 from pg_constraint where conrelid='public.activity_log'::regclass and conname='activity_log_actor_kind_check' and pg_get_constraintdef(oid) like '%system%'),'checked';
insert into batch_14_results(test_name,passed,detail) select '19 Batch B reader and writer boundaries',to_regprocedure('public.list_activity_log(uuid,text,text,uuid,date,date,text,timestamptz,uuid,integer)') is not null and to_regprocedure('ceit_connect_private.write_activity(text,text,uuid,uuid,uuid,uuid,boolean,text,jsonb)') is not null,'checked';
insert into batch_14_results(test_name,passed,detail) select '20 Batch B archive wrapper retained',to_regprocedure('public.archive_event(uuid,bigint,timestamptz)') is not null and to_regprocedure('public.archive_event_pre_batch_b(uuid,bigint,timestamptz)') is not null and not has_function_privilege('authenticated','public.archive_event_pre_batch_b(uuid,bigint,timestamptz)','EXECUTE'),'checked';
insert into batch_14_results(test_name,passed,detail) select '21 Batch D event column and constraints',exists(select 1 from information_schema.columns where table_schema='public' and table_name='events' and column_name='archived_unfinished_task_count') and (select count(*)=2 from pg_constraint where conrelid='public.events'::regclass and conname=any(array['events_archived_unfinished_task_count_nonnegative','events_archived_unfinished_task_count_lifecycle'])),'checked';
insert into batch_14_results(test_name,passed,detail) select '22 Batch D snapshot trigger and latest guard',exists(select 1 from pg_trigger where tgrelid='public.events'::regclass and tgname='events_y0_capture_archive_snapshot' and not tgisinternal and tgfoid='ceit_connect_private.capture_event_archive_snapshot()'::regprocedure) and pg_get_functiondef('public.guard_event_updates()'::regprocedure) like '%old.end_date is not null%' and pg_get_functiondef('public.guard_event_updates()'::regprocedure) like '%new.end_date is null%' and pg_get_functiondef('public.guard_event_updates()'::regprocedure) like '%errcode = ''CCD06''%','checked';
insert into batch_14_results(test_name,passed,detail) select '23 Batch D exact function inventory',count(*)=8,count(*)::text from unnest(array['public.event_auto_archive_grace_days()','public.event_auto_archive_run_retention_days()','ceit_connect_private.capture_event_archive_snapshot()','ceit_connect_private.event_auto_archive_warning_values(date,date)','public.get_event_auto_archive_warning(uuid)','ceit_connect_private.auto_archive_one_event(uuid,date)','ceit_connect_private.purge_event_auto_archive_runs()','public.run_event_auto_archive()']) s(signature) where to_regprocedure(signature) is not null;
insert into batch_14_results(test_name,passed,detail) select '24 Batch D run-history exact shape',to_regclass('ceit_connect_private.event_auto_archive_runs_finished_at_id_idx') is not null and (select count(*)=13 from information_schema.columns where table_schema='ceit_connect_private' and table_name='event_auto_archive_runs') and (select count(*)=11 from pg_constraint where conrelid='ceit_connect_private.event_auto_archive_runs'::regclass) and (select count(*)=7 from information_schema.columns where table_schema='ceit_connect_private' and table_name='event_auto_archive_run_items') and (select count(*)=7 from pg_constraint where conrelid='ceit_connect_private.event_auto_archive_run_items'::regclass),'checked';

-- Rollback-only caller fixtures. UUIDs are isolated from the persistent test accounts.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
select fixture.id, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', fixture.email, '', pg_catalog.now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  pg_catalog.now(), pg_catalog.now()
from (values
  ('b1400000-0000-4000-8000-000000000001'::uuid, 'b14-admin@example.invalid'),
  ('b1400000-0000-4000-8000-000000000002'::uuid, 'b14-coadmin@example.invalid'),
  ('b1400000-0000-4000-8000-000000000003'::uuid, 'b14-member@example.invalid'),
  ('b1400000-0000-4000-8000-000000000004'::uuid, 'b14-inactive@example.invalid'),
  ('b1400000-0000-4000-8000-000000000005'::uuid, 'b14-profileless@example.invalid')
) fixture(id, email);

select set_config('ceit_connect.officer_writer','invite_new_officer',true);
insert into public.users(id,email,full_name,role,committee_id,is_active)
values
('b1400000-0000-4000-8000-000000000001','b14-admin@example.invalid','B14 Admin','Admin',null,true),
('b1400000-0000-4000-8000-000000000002','b14-coadmin@example.invalid','B14 CoAdmin','Co-Admin',(select id from public.committees order by id limit 1),true);
select set_config('ceit_connect.officer_writer','',true);
insert into public.users(id,email,full_name,role,committee_id,is_active)
values
('b1400000-0000-4000-8000-000000000003','b14-member@example.invalid','B14 Member','Member',(select id from public.committees order by id limit 1),true),
('b1400000-0000-4000-8000-000000000004','b14-inactive@example.invalid','B14 Inactive','Member',(select id from public.committees order by id limit 1),false);
insert into public.events(id,name,description,start_date,end_date,status,created_by)
values
('b1400000-0000-4000-8000-000000000101','B14 Draft','fixture',current_date,current_date+1,'Draft','b1400000-0000-4000-8000-000000000001'),
('b1400000-0000-4000-8000-000000000102','B14 Active','fixture',current_date,current_date+1,'Active','b1400000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"b1400000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select set_config('b14.member_count',(select count(*)::text from public.events where id::text like 'b1400000-0000-4000-8000-00000000010%'),true);
reset role;
insert into batch_14_results(test_name,passed,detail) select '25 active Member sees non-Draft only',current_setting('b14.member_count')='1',current_setting('b14.member_count');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"b1400000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select set_config('b14.coadmin_count',(select count(*)::text from public.events where id::text like 'b1400000-0000-4000-8000-00000000010%'),true);
reset role;
insert into batch_14_results(test_name,passed,detail) select '26 active Co-Admin preserves Draft and non-Draft',current_setting('b14.coadmin_count')='2',current_setting('b14.coadmin_count');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"b1400000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('b14.admin_count',(select count(*)::text from public.events where id::text like 'b1400000-0000-4000-8000-00000000010%'),true);
reset role;
insert into batch_14_results(test_name,passed,detail) select '27 active Admin preserves Draft and non-Draft',current_setting('b14.admin_count')='2',current_setting('b14.admin_count');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"b1400000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select set_config('b14.inactive_count',(select count(*)::text from public.events where id::text like 'b1400000-0000-4000-8000-00000000010%'),true);
reset role;
insert into batch_14_results(test_name,passed,detail) select '28 inactive caller sees no events',current_setting('b14.inactive_count')='0',current_setting('b14.inactive_count');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"b1400000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select set_config('b14.profileless_count',(select count(*)::text from public.events where id::text like 'b1400000-0000-4000-8000-00000000010%'),true);
reset role;
insert into batch_14_results(test_name,passed,detail) select '29 profile-less caller sees no events',current_setting('b14.profileless_count')='0',current_setting('b14.profileless_count');
insert into batch_14_results(test_name,passed,detail) select '30 helper allows active Member non-Draft and officers Draft',ceit_connect_private.activity_event_status_visible_for_user('Active','b1400000-0000-4000-8000-000000000003') and ceit_connect_private.activity_event_status_visible_for_user('Draft','b1400000-0000-4000-8000-000000000001') and ceit_connect_private.activity_event_status_visible_for_user('Draft','b1400000-0000-4000-8000-000000000002'),'checked';
insert into batch_14_results(test_name,passed,detail) select '31 helper denies active Member Draft',not ceit_connect_private.activity_event_status_visible_for_user('Draft','b1400000-0000-4000-8000-000000000003'),'checked';
insert into batch_14_results(test_name,passed,detail) select '32 helper denies inactive Member non-Draft',not ceit_connect_private.activity_event_status_visible_for_user('Active','b1400000-0000-4000-8000-000000000004'),'checked';
insert into batch_14_results(test_name,passed,detail) select '33 all result rows pass',count(*)=32 and bool_and(passed),format('%s prior rows',count(*)) from batch_14_results;

select ordinal,test_name,passed,detail from batch_14_results order by ordinal;
do $$
declare v_total integer; v_pass integer; v_failures text;
begin
  select count(*),count(*) filter(where passed),
    string_agg(format('%s [%s]',test_name,detail),'; ' order by ordinal) filter(where not passed)
  into v_total,v_pass,v_failures
  from batch_14_results;
  if v_total<>33 or v_pass<>33 then
    raise exception 'TEST RESULTS: %/% PASS (expected 33/33; failures: %; transaction intentionally rolled back)',
      v_pass,v_total,coalesce(v_failures,'none recorded');
  end if;
  raise exception 'TEST RESULTS: 33/33 PASS — transaction intentionally rolled back';
end $$;
```

`step-d-tests.md` remains a 46-line paste and must pass unchanged after RLS is enabled: it runs as the owner for private-history setup/assertions and explicitly verifies browser-role grants. The Batch 14 revokes cannot affect A/B/D suites because they use DML/RPC capabilities, not `TRUNCATE`, `REFERENCES`, or `TRIGGER`; the new inactive policy intentionally changes only the Batch B inactive-helper expectations already updated in `step-b-tests.md`.
