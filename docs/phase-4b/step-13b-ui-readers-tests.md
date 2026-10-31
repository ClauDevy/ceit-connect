# Step 13b UI readers — Dev SQL tests

**Status:** Additional fixture corrections applied after Dev rerun attempts failed before producing result lines; NOT YET RERUN  
**Migration:** `20261101120000_completed_phase_ui_readers.sql`  
**Rule:** Run each paste independently in Dev. Each paste opens its own transaction,
creates all of its own fixtures, ends with an intentional `TEST RESULTS` exception,
and is rollback-safe. Do not run on Prod before every Dev paste passes.

Expected totals remain explicit: Paste A `24`, Paste B `36`, Paste C `16`,
for **76 result lines** across the three independent pastes.

## Draft completion path confirmed before Run 1

No current first-party UI path can create a Completed task in a Draft event.
Create/Edit Event and template import derive `To Do`; Batch 11 Add/Edit is Active-only;
and `/events/[eventId]` currently loads Active events only. The authenticated
`move_task()` RPC deliberately accepts Draft and Active events, however, so a direct
client call can create a Completed Draft task. Run 2 must therefore consume the
Draft reader state, keep completed phases out of task/phase-action payloads, render
them collapsed/read-only, and preserve metadata-only saves.

## Database caller inventory before rename/recreate

| Public reader | Functions that call it | Views | Policies | Triggers | Why rename/recreate stays correct |
|---|---|---|---|---|---|
| `list_event_board_tasks(uuid,uuid)` | None | None | None | None | Application calls retain the same public signature. The old body is revoked as `list_event_board_tasks_pre13b_ui` and the new wrapper delegates to it. |
| `list_draft_event_editor_tasks(uuid)` | The current `list_event_board_tasks` Draft branch | None | None | None | This reader is recreated first. The renamed board body resolves the unchanged public name at runtime, so its Draft branch reaches the new wrapper and retains its named-column projection. |
| `get_task_detail(uuid)` | None | None | None | None | Same public signature; the wrapper delegates row visibility/masking to the revoked old body. |
| `get_task_edit_controls(uuid)` | None | None | None | None | Same public signature and shape; wrapper only removes capabilities. |
| `get_task_work_links(uuid)` | None | None | None | None | Same public signature and shape; wrapper preserves links and removes add/remove capability. |
| `list_task_comments(uuid,integer,timestamptz,uuid)` | None | None | None | None | Same public signature, shape, and defaults; wrapper preserves paging/content and removes edit/delete capability. |
| `get_task_backup_state(uuid)` | None | None | None | None | Same public signature and shape; wrapper only removes capabilities. |
| `list_pending_task_leave_requests(uuid)` | None | None | None | None | Same public signature/default and shape; wrapper only removes cancel/resolve capability. |

The wrappers add no caller-role gate. Row existence and caller failures come only
from the renamed bodies: inactive callers receive empty rows from Draft, board,
detail, edit-control, work-link, backup, and leave readers; comments retain `CCC01`
with `The task comments are unavailable.` Completion is computed on the side and
can only decorate old-body rows or remove capabilities; it cannot add rows,
synthesize hidden phases/counts, or turn a false capability true.

## Reopen-rule single source

`ceit_connect_private.completed_phase_reopen_actor_allowed(uuid,uuid,boolean)` is
used by both state readers and the real `reopen_completed_phase_task()` writer. It
owns the active-role, Admin/event-creator Co-Admin, and real-content predicates. Its
boolean controls only whether Draft/Active is also required. Readers pass `true`;
Reopen passes `false` before locks and after locking, then `true` after the explicit
Archived precedence check. Unauthorized callers therefore always receive `CCQ03`,
while an otherwise-authorized caller on Archived receives `CCQ04`.
The helper's explicit real-content predicate changes nothing for active Admins in
practice: `task_content_access_for_user` returns `real` for every active Admin on
Draft, Active, and Archived events. It is shared-rule alignment, not a restriction.
Readers then require the same stored `Completed` state and the same
`task_phase_is_complete()` helper that Reopen validates after locking. Paste B proves
the advertised result against actual successful/refused Reopen calls for every role.
Paste A pins both call sites in the catalog, preventing a later body replacement from
silently dropping the shared rule.

Paste B retains the direct reader-advertisement versus real-Reopen parity cases:
Admin checks 1-3, owner Co-Admin checks 4-5, non-owner Co-Admin checks 6-7,
Member checks 8-9, and inactive owner checks 10-12. An inactive caller has no
reader row—and therefore no advertised `can_reopen`—while the helper and writer both
refuse that caller.

`task_phase_is_complete(uuid,text)` cannot return null: its first `CASE` branch
returns `false` for a null event id or a canonical `Unphased` key (including null,
blank, and whitespace phase inputs); otherwise it returns `EXISTS(...) AND NOT
EXISTS(...)`, and both `EXISTS` expressions are non-null booleans. A missing event
therefore also returns `false`. Paste B pins the missing-event, explicit `Unphased`,
and null-phase cases independently.

## Old/new definitions

| Reader | Old return definition | New return definition | Complete-phase difference |
|---|---|---|---|
| `list_event_board_tasks` | 12 columns ending `is_backlog, is_masked` | Same 12 plus `phase_complete, can_reopen, updated_at` | One materialized state per visible canonical phase; timestamp only when `can_reopen`. |
| `list_draft_event_editor_tasks` | 16 columns ending `out_is_masked, out_is_editable` | Same 16 plus `out_phase_complete, out_can_reopen, out_updated_at` | Existing edit scope is ANDed with `not phase_complete`; timestamp only when eligible. |
| `get_task_detail` | 25 columns ending `access_list` | Same 25 plus `phase_complete` | Prior real/masked/hidden row decision is unchanged. |
| `get_task_edit_controls` | 16 capability/data columns | Unchanged | All mutation booleans false and mutation option data empty/null; stored `is_confidential` remains readable. |
| `get_task_work_links` | `can_add, links` | Unchanged | Links remain; add and every remove capability become false. |
| `list_task_comments` | 12 columns; defaults `25, null, null` | Unchanged, including defaults | Comment rows/page remain; edit/delete become false. |
| `get_task_backup_state` | 7 columns | Unchanged | `out_has_volunteered` and `out_volunteers` remain byte-for-byte prior-reader state; only toggle/volunteer/accept capabilities become false. |
| `list_pending_task_leave_requests` | 10 columns; task id defaults null | Unchanged, including default | Any surviving row has resolve/requester-cancel capability false. |

The migration preserves `postgres` ownership, `STABLE SECURITY DEFINER`, empty
`search_path`, and authenticated-only execution. Every `*_pre13b_ui` body is revoked.
Each public reader name has exactly one signature after the migration.

Inactive-caller behavior is identical because every output row still originates in
the prior body:

| Reader | Prior body | New wrapper |
|---|---|---|
| `list_draft_event_editor_tasks` | Empty result | Empty result |
| `list_event_board_tasks` | Empty result | Empty result |
| `get_task_detail` | Empty result | Empty result |
| `get_task_edit_controls` | Empty result | Empty result |
| `get_task_work_links` | Empty result | Empty result |
| `list_task_comments` | Raises `CCC01`: `The task comments are unavailable.` | Raises the same SQLSTATE and message |
| `get_task_backup_state` | Empty result | Empty result |
| `list_pending_task_leave_requests` | Empty result | Empty result |

## Historical SQL documents affected

### Update current-state assertions after Dev passes

- `docs/PHASE-4-STEP-2-TESTS.md`: board output-column/catalog shape.
- `docs/PHASE-4-STEP-3-TESTS.md`: task-detail output shape.
- `docs/PHASE-4-STEP-7-TESTS.md` and `docs/PHASE-4-STEP-7A-TESTS.md`:
  current owner/reader inventories and renamed internal bodies.
- `docs/PHASE-4-STEP-7B-TESTS.md` TEST 5: board/detail/work-link/comment
  positional shape assertions must recognize additive fields while retaining the old
  behavioral expectations.
- `docs/PHASE-4-STEP-8-TESTS.md`: current backup-reader/catalog inventory.
- `docs/PHASE-4-STEP-9-TESTS.md`: current comment-reader catalog and revoked prior body.
- `docs/PHASE-4-STEP-10-TESTS.md` and `docs/PHASE-4-STEP-10E-GATE.md`:
  authoritative reader/internal-body allowlists and affected exact counts.
- `docs/phase-4b/step-13c-tests.md`: additive board/Draft shapes, inactive/null-role
  errors, and the new revoked wrappers. Historical Batch 13c results remain labeled
  historical.

### Rerun without rewriting behavior cases

- Phase 4 Steps 2, 3, 4, 6, 7, 7A, 7B, 8, 9, 9A, and 10 cases that select
  named legacy columns only.
- Batch 11 task-detail/edit-control behavior tests.
- Batch 13 leave-reader behavior tests and the confidentiality-guard follow-up.
- Batch 13b Pastes A, E, and F **must be rerun on Dev after this migration is pushed**
  because it replaces Reopen. Their counts remain A `64`, E `46`, and F `38`: A/F's
  locked-write order remains event row -> event advisory -> phase -> task row, and
  E's Active-event authority/version/result cases remain identical. The new Paste B
  below owns the newly explicit unauthorized-Archived `CCQ03` versus
  authorized-Archived `CCQ04` precedence checks.
- Batch 13c masking, ordering, Draft visibility, paging, and named-column capability
  cases after their current-state catalog rows are updated.

No historical pass count is rewritten in this Run. The eight new
`*_pre13b_ui` functions must be added to the authoritative Phase 4B catalog allowlist
in Batch 14; no Batch 14 file is changed now.

Unrelated hardening proposal only: `move_task()` currently takes the event row lock,
event advisory lock, and exclusive phase lock before caller authorization. Its old
body already took the first two before authorization. Changing that order needs a
separate security/concurrency review and is not part of this migration correction.

## Paste A — catalog, signatures, shapes, defaults and grants

**Expected result lines:** 24 PASS lines, followed by the intentional
`TEST RESULTS: STEP 13B UI-A 24/24 PASS` exception.

```sql
begin;
create temporary table _13b_ui_a_results(
  n integer generated always as identity primary key,
  label text not null,
  passed boolean not null
) on commit drop;

with public_names(name) as (values
 ('list_event_board_tasks'),('list_draft_event_editor_tasks'),
 ('get_task_detail'),('get_task_edit_controls'),('get_task_work_links'),
 ('list_task_comments'),('get_task_backup_state'),
 ('list_pending_task_leave_requests')
), internal_names(name) as (values
 ('list_event_board_tasks_pre13b_ui'),('list_draft_event_editor_tasks_pre13b_ui'),
 ('get_task_detail_pre13b_ui'),('get_task_edit_controls_pre13b_ui'),
 ('get_task_work_links_pre13b_ui'),('list_task_comments_pre13b_ui'),
 ('get_task_backup_state_pre13b_ui'),
 ('list_pending_task_leave_requests_pre13b_ui')
)
insert into _13b_ui_a_results(label,passed) values
('01 exactly one signature per public reader',(select bool_and((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=public_names.name)=1) from public_names)),
('02 every renamed body exists',(select bool_and(exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=internal_names.name)) from internal_names)),
('03 public readers postgres-owned definer stable empty-path',(select bool_and(pg_get_userbyid(p.proowner)='postgres' and p.prosecdef and p.provolatile='s' and p.proconfig=array['search_path=""']) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in(select name from public_names))),
('04 public readers authenticated-only execute',(select bool_and(has_function_privilege('authenticated',p.oid,'EXECUTE') and not has_function_privilege('anon',p.oid,'EXECUTE') and not has_function_privilege('service_role',p.oid,'EXECUTE') and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a where a.grantee=0 and a.privilege_type='EXECUTE')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in(select name from public_names))),
('05 renamed bodies browser/service revoked',(select bool_and(not has_function_privilege('authenticated',p.oid,'EXECUTE') and not has_function_privilege('anon',p.oid,'EXECUTE') and not has_function_privilege('service_role',p.oid,'EXECUTE') and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a where a.grantee=0 and a.privilege_type='EXECUTE')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in(select name from internal_names))),
('06 board has 15 outputs',(select cardinality(proallargtypes)-pronargs=15 from pg_proc where oid='public.list_event_board_tasks(uuid,uuid)'::regprocedure)),
('07 Draft editor has 19 outputs',(select cardinality(proallargtypes)-pronargs=19 from pg_proc where oid='public.list_draft_event_editor_tasks(uuid)'::regprocedure)),
('08 detail has 26 outputs',(select cardinality(proallargtypes)-pronargs=26 from pg_proc where oid='public.get_task_detail(uuid)'::regprocedure)),
('09 edit controls retains 16 outputs',(select cardinality(proallargtypes)-pronargs=16 from pg_proc where oid='public.get_task_edit_controls(uuid)'::regprocedure)),
('10 work links retains 2 outputs',(select cardinality(proallargtypes)-pronargs=2 from pg_proc where oid='public.get_task_work_links(uuid)'::regprocedure)),
('11 comments retains 12 outputs',(select cardinality(proallargtypes)-pronargs=12 from pg_proc where oid='public.list_task_comments(uuid,integer,timestamptz,uuid)'::regprocedure)),
('12 backup retains 7 outputs',(select cardinality(proallargtypes)-pronargs=7 from pg_proc where oid='public.get_task_backup_state(uuid)'::regprocedure)),
('13 leave retains 10 outputs',(select cardinality(proallargtypes)-pronargs=10 from pg_proc where oid='public.list_pending_task_leave_requests(uuid)'::regprocedure)),
('14 board additive names',(select proargnames[cardinality(proargnames)-2:cardinality(proargnames)]=array['phase_complete','can_reopen','updated_at'] from pg_proc where oid='public.list_event_board_tasks(uuid,uuid)'::regprocedure)),
('15 Draft additive names',(select proargnames[cardinality(proargnames)-2:cardinality(proargnames)]=array['out_phase_complete','out_can_reopen','out_updated_at'] from pg_proc where oid='public.list_draft_event_editor_tasks(uuid)'::regprocedure)),
('16 detail additive name',(select proargnames[cardinality(proargnames)]='phase_complete' from pg_proc where oid='public.get_task_detail(uuid)'::regprocedure)),
('17 comments keep all defaults',(select pronargdefaults=3 from pg_proc where oid='public.list_task_comments(uuid,integer,timestamptz,uuid)'::regprocedure)),
('18 leave keeps null default',(select pronargdefaults=1 from pg_proc where oid='public.list_pending_task_leave_requests(uuid)'::regprocedure)),
('19 authority helper pinned',(select pg_get_userbyid(proowner)='postgres' and prosecdef and provolatile='s' and proconfig=array['search_path=""'] from pg_proc where oid='ceit_connect_private.completed_phase_reopen_actor_allowed(uuid,uuid,boolean)'::regprocedure)),
('20 authority helper fully revoked',(select not has_function_privilege('authenticated',p.oid,'EXECUTE') and not has_function_privilege('anon',p.oid,'EXECUTE') and not has_function_privilege('service_role',p.oid,'EXECUTE') and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a where a.grantee=0 and a.privilege_type='EXECUTE') from pg_proc p where p.oid='ceit_connect_private.completed_phase_reopen_actor_allowed(uuid,uuid,boolean)'::regprocedure)),
('21 Reopen first authority call precedes every lock',(with body as (select lower(regexp_replace(regexp_replace(prosrc,E'--[^\n\r]*','','g'),'/[*]([^*]|[*]+[^*/])*[*]+/','','g')) src from pg_proc where oid='public.reopen_completed_phase_task(uuid,timestamptz)'::regprocedure) select position('completed_phase_reopen_actor_allowed' in src)>0 and position('completed_phase_reopen_actor_allowed' in src)<position('for share' in src) and position('completed_phase_reopen_actor_allowed' in src)<position('pg_advisory_xact_lock' in src) and position('completed_phase_reopen_actor_allowed' in src)<position('for update' in src) from body)),
('22 both state readers require open event through shared helper',(select bool_and(regexp_replace(lower(p.prosrc),'\s+',' ','g') ~ 'completed_phase_reopen_actor_allowed\([^;]+ true \)') from pg_proc p where p.oid in('public.list_event_board_tasks(uuid,uuid)'::regprocedure,'public.list_draft_event_editor_tasks(uuid)'::regprocedure))),
('23 both state readers materialize phase states once',(select bool_and(position('phase_states as materialized' in lower(p.prosrc))>0 and position('phase_keys as materialized' in lower(p.prosrc))>0) from pg_proc p where p.oid in('public.list_event_board_tasks(uuid,uuid)'::regprocedure,'public.list_draft_event_editor_tasks(uuid)'::regprocedure))),
('24 no view policy trigger or unrelated function calls public readers',(select not exists(select 1 from pg_views where schemaname not in('pg_catalog','information_schema') and definition ~ '(list_event_board_tasks|list_draft_event_editor_tasks|get_task_detail|get_task_edit_controls|get_task_work_links|list_task_comments|get_task_backup_state|list_pending_task_leave_requests)') and not exists(select 1 from pg_policy where coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),'') ~ '(list_event_board_tasks|list_draft_event_editor_tasks|get_task_detail|get_task_edit_controls|get_task_work_links|list_task_comments|get_task_backup_state|list_pending_task_leave_requests)') and not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname not in('pg_catalog','information_schema') and p.proname not like '%pre13b_ui' and p.proname not in('list_event_board_tasks','list_draft_event_editor_tasks','get_task_detail','get_task_edit_controls','get_task_work_links','list_task_comments','get_task_backup_state','list_pending_task_leave_requests') and p.prosrc ~ '(list_event_board_tasks|list_draft_event_editor_tasks|get_task_detail|get_task_edit_controls|get_task_work_links|list_task_comments|get_task_backup_state|list_pending_task_leave_requests)')));

do $$ begin
 if (select count(*) from _13b_ui_a_results)<>24 or exists(select 1 from _13b_ui_a_results where not passed) then
  raise exception 'STEP 13B UI-A FAIL';
 end if;
end $$;
select format('%s: PASS',label) from _13b_ui_a_results order by n;
do $$ begin raise exception 'TEST RESULTS: STEP 13B UI-A 24/24 PASS'; end $$;
rollback;
```

## Paste B — authoritative state, masking and actual Reopen parity

**Expected result lines:** 36 PASS lines, followed by the intentional
`TEST RESULTS: STEP 13B UI-B 36/36 PASS` exception.

```sql
begin;
set local timezone='Asia/Manila';
create temporary table _13b_ui_b_results(n integer primary key,label text,passed boolean not null) on commit drop;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('13bd0000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ui-admin@example.test',crypt('Step13b-ui-1!',gen_salt('bf')),now(),'{}','{}',now(),now()),
('13bd0000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ui-owner@example.test',crypt('Step13b-ui-1!',gen_salt('bf')),now(),'{}','{}',now(),now()),
('13bd0000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ui-other@example.test',crypt('Step13b-ui-1!',gen_salt('bf')),now(),'{}','{}',now(),now()),
('13bd0000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ui-member@example.test',crypt('Step13b-ui-1!',gen_salt('bf')),now(),'{}','{}',now(),now()),
('13bd0000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ui-inactive@example.test',crypt('Step13b-ui-1!',gen_salt('bf')),now(),'{}','{}',now(),now());
insert into public.committees(id,name) values
('13bd1000-0000-4000-8000-000000000001','UI Owner Committee'),
('13bd1000-0000-4000-8000-000000000002','UI Other Committee');
insert into public.users(id,email,full_name,role,committee_id,is_active) values
('13bd0000-0000-4000-8000-000000000001','ui-admin@example.test','UI Admin','Admin',null,true),
('13bd0000-0000-4000-8000-000000000002','ui-owner@example.test','UI Owner','Co-Admin','13bd1000-0000-4000-8000-000000000001',true),
('13bd0000-0000-4000-8000-000000000003','ui-other@example.test','UI Other','Co-Admin','13bd1000-0000-4000-8000-000000000002',true),
('13bd0000-0000-4000-8000-000000000004','ui-member@example.test','UI Member','Member','13bd1000-0000-4000-8000-000000000001',true),
('13bd0000-0000-4000-8000-000000000005','ui-inactive@example.test','UI Inactive','Co-Admin','13bd1000-0000-4000-8000-000000000001',false);
insert into public.events(id,name,start_date,end_date,status,created_by) values
('13bd2000-0000-4000-8000-000000000001','Admin Reopen','2026-11-01','2026-11-02','Active','13bd0000-0000-4000-8000-000000000002'),
('13bd2000-0000-4000-8000-000000000002','Owner Reopen','2026-11-01','2026-11-02','Active','13bd0000-0000-4000-8000-000000000002'),
('13bd2000-0000-4000-8000-000000000003','Refused Reopen','2026-11-01','2026-11-02','Active','13bd0000-0000-4000-8000-000000000002'),
('13bd2000-0000-4000-8000-000000000004','Inactive Owner','2026-11-01','2026-11-02','Active','13bd0000-0000-4000-8000-000000000005'),
('13bd2000-0000-4000-8000-000000000005','Mixed Hidden State','2026-11-01','2026-11-02','Active','13bd0000-0000-4000-8000-000000000002'),
('13bd2000-0000-4000-8000-000000000006','Incomplete Parity','2026-11-01','2026-11-02','Active','13bd0000-0000-4000-8000-000000000002'),
('13bd2000-0000-4000-8000-000000000007','Draft Parity','2026-11-01','2026-11-02','Draft','13bd0000-0000-4000-8000-000000000002'),
('13bd2000-0000-4000-8000-000000000008','Archived precedence','2026-11-01','2026-11-02','Active','13bd0000-0000-4000-8000-000000000002');
select set_config('request.jwt.claims','{"sub":"13bd0000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('ceit_connect.task_access_writer','create_active_event_task',true);
insert into public.tasks(id,event_id,committee_id,title,phase,status,is_confidential) values
('13bd3000-0000-4000-8000-000000000001','13bd2000-0000-4000-8000-000000000001','13bd1000-0000-4000-8000-000000000001','Admin candidate','Admin phase','To Do',false),
('13bd3000-0000-4000-8000-000000000002','13bd2000-0000-4000-8000-000000000002','13bd1000-0000-4000-8000-000000000001','Owner candidate','Owner phase','To Do',false),
('13bd3000-0000-4000-8000-000000000003','13bd2000-0000-4000-8000-000000000003','13bd1000-0000-4000-8000-000000000001','Refused candidate','Refused phase','To Do',false),
('13bd3000-0000-4000-8000-000000000004','13bd2000-0000-4000-8000-000000000004','13bd1000-0000-4000-8000-000000000001','Inactive candidate','Inactive phase','To Do',false),
('13bd3000-0000-4000-8000-000000000005','13bd2000-0000-4000-8000-000000000005','13bd1000-0000-4000-8000-000000000001','Visible complete','Mixed phase','To Do',false),
('13bd3000-0000-4000-8000-000000000006','13bd2000-0000-4000-8000-000000000005','13bd1000-0000-4000-8000-000000000002','Hidden incomplete','Mixed phase','To Do',true),
('13bd3000-0000-4000-8000-000000000007','13bd2000-0000-4000-8000-000000000005','13bd1000-0000-4000-8000-000000000001','Unphased complete',null,'To Do',false),
('13bd3000-0000-4000-8000-000000000008','13bd2000-0000-4000-8000-000000000006','13bd1000-0000-4000-8000-000000000001','Open task','Open phase','To Do',false),
('13bd3000-0000-4000-8000-000000000009','13bd2000-0000-4000-8000-000000000007','13bd1000-0000-4000-8000-000000000001','Draft open','Draft phase','To Do',false),
('13bd3000-0000-4000-8000-000000000010','13bd2000-0000-4000-8000-000000000008','13bd1000-0000-4000-8000-000000000002','Archived candidate','Archived phase','To Do',false);
select set_config('ceit_connect.task_access_writer','',true);
update public.tasks set status='Completed' where id in(
'13bd3000-0000-4000-8000-000000000001','13bd3000-0000-4000-8000-000000000002',
'13bd3000-0000-4000-8000-000000000003','13bd3000-0000-4000-8000-000000000004',
'13bd3000-0000-4000-8000-000000000005','13bd3000-0000-4000-8000-000000000007',
'13bd3000-0000-4000-8000-000000000010');
select public.archive_event('13bd2000-0000-4000-8000-000000000008',0,(select updated_at from public.events where id='13bd2000-0000-4000-8000-000000000008'));

insert into _13b_ui_b_results values
(1,'Admin candidate advertised',(select phase_complete and can_reopen and updated_at is not null from public.list_event_board_tasks('13bd2000-0000-4000-8000-000000000001',null) where id='13bd3000-0000-4000-8000-000000000001')),
(2,'Admin exact timestamp',(select b.updated_at=t.updated_at from public.list_event_board_tasks('13bd2000-0000-4000-8000-000000000001',null)b join public.tasks t on t.id=b.id where b.id='13bd3000-0000-4000-8000-000000000001'));
select * from public.reopen_completed_phase_task('13bd3000-0000-4000-8000-000000000001',(select updated_at from public.tasks where id='13bd3000-0000-4000-8000-000000000001'));
insert into _13b_ui_b_results values(3,'Admin advertised candidate accepted',(select status='In Progress' from public.tasks where id='13bd3000-0000-4000-8000-000000000001'));

select set_config('request.jwt.claims','{"sub":"13bd0000-0000-4000-8000-000000000002","role":"authenticated"}',true);
insert into _13b_ui_b_results values
(4,'owner Co-Admin candidate advertised',(select phase_complete and can_reopen and updated_at is not null from public.list_event_board_tasks('13bd2000-0000-4000-8000-000000000002',null) where id='13bd3000-0000-4000-8000-000000000002'));
select * from public.reopen_completed_phase_task('13bd3000-0000-4000-8000-000000000002',(select updated_at from public.tasks where id='13bd3000-0000-4000-8000-000000000002'));
insert into _13b_ui_b_results values(5,'owner Co-Admin advertised candidate accepted',(select status='In Progress' from public.tasks where id='13bd3000-0000-4000-8000-000000000002'));

select set_config('request.jwt.claims','{"sub":"13bd0000-0000-4000-8000-000000000003","role":"authenticated"}',true);
insert into _13b_ui_b_results values
(6,'non-owner Co-Admin not advertised',(select phase_complete and not can_reopen and updated_at is null from public.list_event_board_tasks('13bd2000-0000-4000-8000-000000000003',null) where id='13bd3000-0000-4000-8000-000000000003'));
do $$ declare denied boolean:=false; begin begin perform public.reopen_completed_phase_task('13bd3000-0000-4000-8000-000000000003',(select updated_at from public.tasks where id='13bd3000-0000-4000-8000-000000000003')); exception when sqlstate 'CCQ03' then denied:=true; end; insert into _13b_ui_b_results values(7,'non-owner Co-Admin refused by real Reopen',denied); end $$;

select set_config('request.jwt.claims','{"sub":"13bd0000-0000-4000-8000-000000000004","role":"authenticated"}',true);
insert into _13b_ui_b_results values
(8,'Member not advertised',(select phase_complete and not can_reopen and updated_at is null from public.list_event_board_tasks('13bd2000-0000-4000-8000-000000000003',null) where id='13bd3000-0000-4000-8000-000000000003'));
do $$ declare denied boolean:=false; begin begin perform public.reopen_completed_phase_task('13bd3000-0000-4000-8000-000000000003',(select updated_at from public.tasks where id='13bd3000-0000-4000-8000-000000000003')); exception when sqlstate 'CCQ03' then denied:=true; end; insert into _13b_ui_b_results values(9,'Member refused by real Reopen',denied); end $$;

select set_config('request.jwt.claims','{"sub":"13bd0000-0000-4000-8000-000000000005","role":"authenticated"}',true);
insert into _13b_ui_b_results values(10,'inactive board matches prior empty',(select count(*)=0 from public.list_event_board_tasks('13bd2000-0000-4000-8000-000000000004',null)) and (select count(*)=0 from public.list_event_board_tasks_pre13b_ui('13bd2000-0000-4000-8000-000000000004',null)));
do $$ declare rpc_denied boolean:=false; begin begin perform public.reopen_completed_phase_task('13bd3000-0000-4000-8000-000000000004',(select updated_at from public.tasks where id='13bd3000-0000-4000-8000-000000000004')); exception when sqlstate 'CCQ03' then rpc_denied:=true; end; insert into _13b_ui_b_results values(11,'inactive owner refused by real Reopen',rpc_denied); end $$;
insert into _13b_ui_b_results values(12,'inactive owner helper false',not ceit_connect_private.completed_phase_reopen_actor_allowed('13bd3000-0000-4000-8000-000000000004','13bd0000-0000-4000-8000-000000000005',true));
insert into _13b_ui_b_results values
(13,'inactive Draft reader matches prior empty',(select count(*)=0 from public.list_draft_event_editor_tasks('13bd2000-0000-4000-8000-000000000007')) and (select count(*)=0 from public.list_draft_event_editor_tasks_pre13b_ui('13bd2000-0000-4000-8000-000000000007'))),
(14,'inactive detail reader matches prior empty',(select count(*)=0 from public.get_task_detail('13bd3000-0000-4000-8000-000000000004')) and (select count(*)=0 from public.get_task_detail_pre13b_ui('13bd3000-0000-4000-8000-000000000004'))),
(15,'inactive edit controls match prior empty',(select count(*)=0 from public.get_task_edit_controls('13bd3000-0000-4000-8000-000000000004')) and (select count(*)=0 from public.get_task_edit_controls_pre13b_ui('13bd3000-0000-4000-8000-000000000004'))),
(16,'inactive work links match prior empty',(select count(*)=0 from public.get_task_work_links('13bd3000-0000-4000-8000-000000000004')) and (select count(*)=0 from public.get_task_work_links_pre13b_ui('13bd3000-0000-4000-8000-000000000004'))),
(18,'inactive backup matches prior empty',(select count(*)=0 from public.get_task_backup_state('13bd3000-0000-4000-8000-000000000004')) and (select count(*)=0 from public.get_task_backup_state_pre13b_ui('13bd3000-0000-4000-8000-000000000004'))),
(19,'inactive leave reader matches prior empty',(select count(*)=0 from public.list_pending_task_leave_requests('13bd3000-0000-4000-8000-000000000004')) and (select count(*)=0 from public.list_pending_task_leave_requests_pre13b_ui('13bd3000-0000-4000-8000-000000000004')));
do $$ declare new_error text:='no error'; old_error text:='no error'; begin begin perform * from public.list_task_comments('13bd3000-0000-4000-8000-000000000004'); exception when others then new_error:=sqlstate||':'||sqlerrm; end; begin perform * from public.list_task_comments_pre13b_ui('13bd3000-0000-4000-8000-000000000004'); exception when others then old_error:=sqlstate||':'||sqlerrm; end; insert into _13b_ui_b_results values(17,'inactive comments retain prior CCC01',new_error=old_error and new_error='CCC01:The task comments are unavailable.'); end $$;

select set_config('request.jwt.claims','{"sub":"13bd0000-0000-4000-8000-000000000002","role":"authenticated"}',true);
insert into _13b_ui_b_results values
(20,'masked task stays masked',(select is_masked and title='Confidential Task' and not can_reopen and updated_at is null from public.list_event_board_tasks('13bd2000-0000-4000-8000-000000000005',null) where id='13bd3000-0000-4000-8000-000000000006')),
(21,'hidden incomplete task prevents false completion',(select not phase_complete and not can_reopen and updated_at is null from public.list_event_board_tasks('13bd2000-0000-4000-8000-000000000005',null) where id='13bd3000-0000-4000-8000-000000000005')),
(22,'no hidden count exposed',(select count(*)=2 from public.list_event_board_tasks('13bd2000-0000-4000-8000-000000000005',null) where public.canonical_task_phase(phase)='Mixed phase')),
(23,'Unphased never completes',(select not phase_complete and not can_reopen and updated_at is null from public.list_event_board_tasks('13bd2000-0000-4000-8000-000000000005',null) where id='13bd3000-0000-4000-8000-000000000007'));

select set_config('request.jwt.claims','{"sub":"13bd0000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into _13b_ui_b_results values
(24,'incomplete board legacy row unchanged',(select (to_jsonb(new_row)-'phase_complete'-'can_reopen'-'updated_at')=to_jsonb(old_row) from public.list_event_board_tasks('13bd2000-0000-4000-8000-000000000006',null)new_row join public.list_event_board_tasks_pre13b_ui('13bd2000-0000-4000-8000-000000000006',null)old_row using(id))),
(25,'incomplete board new fields safe',(select not phase_complete and not can_reopen and updated_at is null from public.list_event_board_tasks('13bd2000-0000-4000-8000-000000000006',null))),
(26,'incomplete Draft legacy row unchanged',(select (to_jsonb(new_row)-'out_phase_complete'-'out_can_reopen'-'out_updated_at')=to_jsonb(old_row) from public.list_draft_event_editor_tasks('13bd2000-0000-4000-8000-000000000007')new_row join public.list_draft_event_editor_tasks_pre13b_ui('13bd2000-0000-4000-8000-000000000007')old_row using(out_task_id))),
(27,'incomplete Draft new fields safe',(select not out_phase_complete and not out_can_reopen and out_updated_at is null from public.list_draft_event_editor_tasks('13bd2000-0000-4000-8000-000000000007'))),
(28,'detail receives authoritative completion',(select phase_complete from public.get_task_detail('13bd3000-0000-4000-8000-000000000003'))),
(29,'detail legacy fields unchanged',(select (to_jsonb(new_row)-'phase_complete')=to_jsonb(old_row) from public.get_task_detail('13bd3000-0000-4000-8000-000000000003')new_row join public.get_task_detail_pre13b_ui('13bd3000-0000-4000-8000-000000000003')old_row using(id)));

select set_config('request.jwt.claims','{"sub":"13bd0000-0000-4000-8000-000000000004","role":"authenticated"}',true);
insert into _13b_ui_b_results values
(30,'hidden Draft task leaks no detail row',(select count(*)=0 from public.get_task_detail('13bd3000-0000-4000-8000-000000000009')));

select set_config('request.jwt.claims','{"sub":"13bd0000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$ declare denied boolean:=false; begin begin perform public.reopen_completed_phase_task('13bd3000-0000-4000-8000-000000000010',(select updated_at from public.tasks where id='13bd3000-0000-4000-8000-000000000010')); exception when sqlstate 'CCQ04' then denied:=true; end; insert into _13b_ui_b_results values(31,'authorized Admin on Archived receives CCQ04',denied); end $$;
select set_config('request.jwt.claims','{"sub":"13bd0000-0000-4000-8000-000000000003","role":"authenticated"}',true);
do $$ declare denied boolean:=false; begin begin perform public.reopen_completed_phase_task('13bd3000-0000-4000-8000-000000000010',(select updated_at from public.tasks where id='13bd3000-0000-4000-8000-000000000010')); exception when sqlstate 'CCQ03' then denied:=true; end; insert into _13b_ui_b_results values(32,'non-owner Co-Admin on Archived receives CCQ03',denied); end $$;
select set_config('request.jwt.claims','{"sub":"13bd0000-0000-4000-8000-000000000004","role":"authenticated"}',true);
do $$ declare denied boolean:=false; begin begin perform public.reopen_completed_phase_task('13bd3000-0000-4000-8000-000000000010',(select updated_at from public.tasks where id='13bd3000-0000-4000-8000-000000000010')); exception when sqlstate 'CCQ03' then denied:=true; end; insert into _13b_ui_b_results values(33,'unauthorized Member on Archived receives CCQ03',denied); end $$;
insert into _13b_ui_b_results values
(34,'missing event completion is false',public.task_phase_is_complete('13bd2fff-0000-4000-8000-000000000000','Missing') is false),
(35,'Unphased completion is false',public.task_phase_is_complete('13bd2000-0000-4000-8000-000000000005','Unphased') is false),
(36,'null phase completion is false',public.task_phase_is_complete('13bd2000-0000-4000-8000-000000000005',null) is false);

do $$ begin if (select count(*) from _13b_ui_b_results)<>36 or exists(select 1 from _13b_ui_b_results where not passed) then raise exception 'STEP 13B UI-B FAIL'; end if; end $$;
select format('%s %s: PASS',lpad(n::text,2,'0'),label) from _13b_ui_b_results order by n;
do $$ begin raise exception 'TEST RESULTS: STEP 13B UI-B 36/36 PASS'; end $$;
rollback;
```

## Paste C — completed capability suppression and incomplete parity

**Expected result lines:** 16 PASS lines, followed by the intentional
`TEST RESULTS: STEP 13B UI-C 16/16 PASS` exception.

```sql
begin;
set local timezone='Asia/Manila';
create temporary table _13b_ui_c_results(n integer primary key,label text,passed boolean not null) on commit drop;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('13be0000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ui-c-admin@example.test',crypt('Step13b-ui-1!',gen_salt('bf')),now(),'{}','{}',now(),now()),
('13be0000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000000','authenticated','authenticated','ui-c-member@example.test',crypt('Step13b-ui-1!',gen_salt('bf')),now(),'{}','{}',now(),now());
insert into public.committees(id,name) values('13be1000-0000-4000-8000-000000000001','UI Capability Committee');
insert into public.users(id,email,full_name,role,committee_id,is_active) values
('13be0000-0000-4000-8000-000000000001','ui-c-admin@example.test','UI C Admin','Admin',null,true),
('13be0000-0000-4000-8000-000000000002','ui-c-member@example.test','UI C Member','Member','13be1000-0000-4000-8000-000000000001',true);
insert into public.events(id,name,start_date,end_date,status,created_by) values('13be2000-0000-4000-8000-000000000001','Capability Event','2026-11-01','2026-11-02','Active','13be0000-0000-4000-8000-000000000001');
select set_config('request.jwt.claims','{}',true);
select set_config('ceit_connect.task_assignee_writer','create_event_with_tasks',true);
insert into public.tasks(id,event_id,committee_id,title,phase,status,primary_assignees) values
('13be3000-0000-4000-8000-000000000001','13be2000-0000-4000-8000-000000000001','13be1000-0000-4000-8000-000000000001','Completed capability','Complete','To Do',array['13be0000-0000-4000-8000-000000000001'::uuid]),
('13be3000-0000-4000-8000-000000000002','13be2000-0000-4000-8000-000000000001','13be1000-0000-4000-8000-000000000001','Incomplete parity','Open','To Do','{}'::uuid[]);
select set_config('ceit_connect.task_assignee_writer','',true);
select set_config('request.jwt.claims','{"sub":"13be0000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into public.task_work_links(task_id,name,url,created_by) values('13be3000-0000-4000-8000-000000000001','Evidence','https://drive.google.com/file/d/13beEvidence/view','13be0000-0000-4000-8000-000000000001');
insert into public.task_comments(task_id,created_by,body) values('13be3000-0000-4000-8000-000000000001','13be0000-0000-4000-8000-000000000001','Completed phase comment');
update public.tasks set status='Completed' where id='13be3000-0000-4000-8000-000000000001';

insert into _13b_ui_c_results values
(1,'edit controls row retained',(select count(*)=1 from public.get_task_edit_controls('13be3000-0000-4000-8000-000000000001'))),
(2,'edit mutation booleans all false',(select not can_set_dependency and not can_set_confidentiality and not can_edit_task and not can_assign_people and not can_delete and not can_unassign_self from public.get_task_edit_controls('13be3000-0000-4000-8000-000000000001'))),
(3,'edit mutation data empty and confidentiality readable',(select new_row.self_unassign_block_code is null and not new_row.self_unassign_will_lose_access and new_row.depends_on_task_id is null and new_row.is_confidential is not distinct from old_row.is_confidential and new_row.allowed_viewers='[]'::jsonb and new_row.dependency_options='[]'::jsonb and new_row.viewer_options='[]'::jsonb and new_row.primary_assignees='[]'::jsonb and new_row.assist_assignees='[]'::jsonb and new_row.assignee_options='[]'::jsonb from public.get_task_edit_controls('13be3000-0000-4000-8000-000000000001')new_row join public.get_task_edit_controls_pre13b_ui('13be3000-0000-4000-8000-000000000001')old_row on true)),
(4,'work link add false',(select not can_add from public.get_task_work_links('13be3000-0000-4000-8000-000000000001'))),
(5,'work link remove false',(select not exists(select 1 from public.get_task_work_links('13be3000-0000-4000-8000-000000000001')w cross join lateral jsonb_array_elements(w.links)x(value) where (x.value->>'can_remove')::boolean))),
(6,'comment edit delete false',(select bool_and(not out_can_edit and not out_can_delete) from public.list_task_comments('13be3000-0000-4000-8000-000000000001'))),
(7,'backup row retained',(select count(*)=1 from public.get_task_backup_state('13be3000-0000-4000-8000-000000000001'))),
(8,'backup only action capabilities suppressed',(select not new_row.out_can_toggle_backup and not new_row.out_can_volunteer and not new_row.out_can_accept and new_row.out_has_volunteered=old_row.out_has_volunteered and new_row.out_volunteers=old_row.out_volunteers from public.get_task_backup_state('13be3000-0000-4000-8000-000000000001')new_row join public.get_task_backup_state_pre13b_ui('13be3000-0000-4000-8000-000000000001')old_row on true)),
(9,'leave reader exposes no complete mutation capability',(select not exists(select 1 from public.list_pending_task_leave_requests('13be3000-0000-4000-8000-000000000001') where out_can_resolve or out_is_requester))),
(10,'incomplete edit controls unchanged',(select to_jsonb(new_row)=to_jsonb(old_row) from public.get_task_edit_controls('13be3000-0000-4000-8000-000000000002')new_row join public.get_task_edit_controls_pre13b_ui('13be3000-0000-4000-8000-000000000002')old_row on true)),
(11,'incomplete work links unchanged',(select to_jsonb(new_row)=to_jsonb(old_row) from public.get_task_work_links('13be3000-0000-4000-8000-000000000002')new_row join public.get_task_work_links_pre13b_ui('13be3000-0000-4000-8000-000000000002')old_row on true)),
(12,'incomplete comments unchanged',(select coalesce((select jsonb_agg(to_jsonb(x) order by out_created_at,out_id) from public.list_task_comments('13be3000-0000-4000-8000-000000000002')x),'[]'::jsonb)=coalesce((select jsonb_agg(to_jsonb(x) order by out_created_at,out_id) from public.list_task_comments_pre13b_ui('13be3000-0000-4000-8000-000000000002')x),'[]'::jsonb))),
(13,'incomplete backup unchanged',(select to_jsonb(new_row)=to_jsonb(old_row) from public.get_task_backup_state('13be3000-0000-4000-8000-000000000002')new_row join public.get_task_backup_state_pre13b_ui('13be3000-0000-4000-8000-000000000002')old_row on true)),
(14,'incomplete leave unchanged',(select coalesce((select jsonb_agg(to_jsonb(x) order by out_created_at,out_id) from public.list_pending_task_leave_requests('13be3000-0000-4000-8000-000000000002')x),'[]'::jsonb)=coalesce((select jsonb_agg(to_jsonb(x) order by out_created_at,out_id) from public.list_pending_task_leave_requests_pre13b_ui('13be3000-0000-4000-8000-000000000002')x),'[]'::jsonb))),
(15,'null caller detail matches prior empty',(select true)),
(16,'completed logic never widens rows',(select (select count(*) from public.get_task_detail('13be3000-0000-4000-8000-000000000001'))=(select count(*) from public.get_task_detail_pre13b_ui('13be3000-0000-4000-8000-000000000001'))));

do $$ begin
 perform set_config('request.jwt.claims','{}',true);
 update _13b_ui_c_results set passed=(select count(*)=0 from public.get_task_detail('13be3000-0000-4000-8000-000000000001')) and (select count(*)=0 from public.get_task_detail_pre13b_ui('13be3000-0000-4000-8000-000000000001')) where n=15;
end $$;
do $$ begin if (select count(*) from _13b_ui_c_results)<>16 or exists(select 1 from _13b_ui_c_results where not passed) then raise exception 'STEP 13B UI-C FAIL'; end if; end $$;
select format('%s %s: PASS',lpad(n::text,2,'0'),label) from _13b_ui_c_results order by n;
do $$ begin raise exception 'TEST RESULTS: STEP 13B UI-C 16/16 PASS'; end $$;
rollback;
```

## Run 2 minimum Draft editor work

After all three Dev pastes pass, Run 2 should do only the required Draft work:

1. Normalize missing additive fields to false/null for the app-before-migration window.
2. Move authoritative completed-phase persisted tasks from editable form state into
   the existing read-only reader rows.
3. Remove their queued update/delete/rename phase actions while retaining event
   metadata fields.
4. Default completed phase cards collapsed and render no mutation controls.
5. Offer Reopen only from returned `out_can_reopen` rows and pass
   `out_updated_at` unchanged.
6. Exclude completed phases from Active Add/Edit phase choices.

