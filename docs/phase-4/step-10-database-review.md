# Step 10A — Phase 4 database review

## Findings

| Severity | Finding |
|---|---|
| Critical | None found in the tracked migration definitions. |
| High | None found in the tracked migration definitions. |
| Medium | None found in the tracked migration definitions. |
| Low | None found in the tracked migration definitions. |
| Informational | The source review cannot prove that live Dev has no drift. Run the read-only catalog paste in `docs/PHASE-4-STEP-10-TESTS.md`; its expected result counts are `57 / 8 / 11 / 20 / 0`. |

No migration is proposed by this review. The review found no service-role client in ordinary task flows. The repository's service-role uses remain limited to Auth/account administration, avatar maintenance, and the already documented event-banner cleanup path; board, task detail, archive, move, dependency, assignment, backup, volunteer, comments, work links, late sharing, Help Wanted, and My Tasks all use the caller's Supabase session.

## Review method

The inventory was built from the ordered migrations `20261016120000` through `20261023160000`. Every `CREATE [OR REPLACE] FUNCTION`, function grant/revoke, table, policy, and trigger was searched; later definitions were resolved by exact name/signature. Existing event/task/activity/invariant objects that Phase 4 replaces or relies on are included as boundaries.

For each function, the review checked fixed empty `search_path`, expected `postgres` ownership, security mode, volatility, explicit execute revokes/grants, absence of a second signature, active/profile-less denial (directly or through the shared content decision), contractual lock/recheck order, and exact-one affected-row checks where the operation targets one row. Set-based cleanup deletes are intentionally not exact-one operations. For policies it checked command/role plus `USING`/`WITH CHECK`, active gates, and narrow raw-task authorization. For triggers it checked attachment, timing, enabled-state expectation, task→event child locking, immutable parents, and deferred invariant attachment. For tables it checked RLS, privileges, constraints, parent immutability, archive freeze, and deny-by-default child access.

Legend: **auth** means only `authenticated` receives execute; **internal** means no client role receives execute; **delegated active** means the function calls the reviewed current-access helper or is protected by an active-gated invoker policy; **N/A** means a pure/trigger helper does not authorize a caller.

## Functions

All 57 effective signatures have an explicit empty `search_path`; no tracked Phase 4 name has a second signature. All are expected to be owned by `postgres`. The live paste exposes any departure.

| Function signature | Latest definition | Security / volatility / execute | Authorization, locks, and row-count review |
|---|---|---|---|
| `accept_task_volunteer(uuid, uuid)` | `20261022120000` | definer / volatile / auth | Direct active check; task→event locks; assignment cap and exact task update checked. |
| `add_task_comment(uuid, text, boolean, uuid[])` | `20261023130000` | definer / volatile / auth | Direct active/current-real check; task→event locks and recheck; one inserted row returned. |
| `add_task_work_link(uuid, text, text)` | `20261017150000` | definer / volatile / auth | Delegated active/current-real check; task→event locks in guard; one inserted row returned. |
| `archive_event(uuid, bigint, timestamptz)` | `20261016130000` | definer / volatile / auth | Active Admin checked before lookup; event lock precedes recount; exact event update count checked; no task-row lock. |
| `assign_task_creation_metadata()` | `20261018120000` | definer / volatile / internal | Trigger-only; derives creator and lane rank; shared advisory serialization; N/A caller authorization. |
| `assign_task_people(uuid, uuid[], uuid[])` | `20261021130000` | definer / volatile / auth | Direct active/current-real check; event/advisory/task order; exact task update checked. |
| `calculate_effective_task_priority(text, timestamptz, timestamptz, text)` | `20261016140000` | invoker / immutable / internal | Pure calculation; no reads or writes. |
| `claim_task(uuid)` | `20261022120000` | definer / volatile / auth | Direct active/current-real check; task→event locks; exact task update checked. |
| `delete_task(uuid)` | `20261021130000` | definer / volatile / auth | Direct active/current-real check; task/event/advisory serialization; exact delete checked; deferred last-task guard remains authoritative. |
| `delete_task_comment(uuid)` | `20261023130000` | definer / volatile / auth | Direct active/current-real check; task→event locks and post-lock authorization; exact delete checked. |
| `edit_event_with_tasks(uuid, timestamptz, text, text, date, date, text, jsonb, jsonb, uuid[])` | `20261018120000` | invoker / volatile / auth | Active-gated RLS; stored-event/advisory/task ordering; every targeted update/delete count checked. |
| `edit_task_comment(uuid, text, boolean, uuid[], timestamptz)` | `20261023130000` | definer / volatile / auth | Direct active/current-real check; task→event/comment locks and post-lock recheck; exact update checked. |
| `get_archived_task_share_controls(uuid, text)` | `20261023160000` | definer / stable / auth | Direct active leadership check; lock-free reader; fixed 20-result search. |
| `get_task(uuid)` | `20261016140000` | definer / volatile / auth | Delegates current active-content decision; fixed three-column response; no writes. |
| `get_task_backup_state(uuid)` | `20261022120000` | definer / stable / auth | Direct active/current-real check; no writes. |
| `get_task_detail(uuid)` | `20261023160000` | definer / stable / auth | Direct active check plus current shared access decision, including archive-only grants; no writes. |
| `get_task_edit_controls(uuid)` | `20261021130000` | definer / stable / auth | Direct active/current-real check; no writes. |
| `get_task_work_links(uuid)` | `20261017170000` | definer / stable / auth | Delegated current active-content decision; no writes. |
| `grant_archived_task_viewer(uuid, uuid)` | `20261023160000` | definer / volatile / auth | Active leadership before task→event locks, then recheck; exact insert-or-existing outcome checked. |
| `guard_archived_event_task_writes()` | `20261016130000` | definer / volatile / internal | Trigger-only; locks distinct parent events then re-reads status; blocks every Archived task write. |
| `guard_archived_task_viewer_writes()` | `20261023160000` | definer / volatile / internal | Trigger-only; stored task→event order; immutable child parent; derives grantor. |
| `guard_referenced_prerequisite_deletion()` | `20261018120000` | definer / volatile / internal | Trigger-only; clear direct-delete rejection while preserving whole-event cascade. |
| `guard_task_comment_writes()` | `20261023130000` | definer / volatile / internal | Trigger-only; stored task→event order; child parent/creator immutability and archive freeze. |
| `guard_task_volunteer_writes()` | `20261022120000` | definer / volatile / internal | Trigger-only; stored task→event order; rejects all updates and Archived-parent writes. |
| `guard_task_work_link_updates()` | `20261017150000` | definer / volatile / internal | Trigger-only; rejects updates except FK-driven creator nulling; task id immutable. |
| `guard_task_work_link_writes()` | `20261017150000` | definer / volatile / internal | Trigger-only; stored task→event order; current-real/cap checks and archive freeze. |
| `list_active_task_assignees_with_workload()` | `20261022120000` | definer / stable / auth | Direct active leadership check; no writes; confidential-safe counts. |
| `list_event_board_tasks(uuid, uuid)` | `20261021130000` | definer / stable / auth | Direct active check; shared current-content decision; no writes; masked shells remain narrow. |
| `list_help_wanted_tasks(integer, integer)` | `20261022120000` | definer / stable / auth | Direct active check and real-content filter; validated pagination; no writes. |
| `list_my_tasks(text, text, integer, integer)` | `20261022150000` | definer / stable / auth | Caller-derived active assignment scope; validated filter/sort/page; no writes. |
| `list_task_comment_mention_candidates(uuid, text, integer)` | `20261023130000` | definer / stable / auth | Current-real caller and active candidates only; validated limit; no writes. |
| `list_task_comments(uuid, integer, timestamptz, uuid)` | `20261023130000` | definer / stable / auth | Direct active/current-real check; validated cursor/limit; no writes. |
| `log_task_activity()` | `20261018130000` | definer / volatile / internal | Trigger-only; one real mutation log; no-op and rank-only updates are silent. |
| `move_task(uuid, text, text, text, uuid, uuid)` | `20261018130000` | definer / volatile / auth | Direct active/current-real check; event/advisory/task order and stale rechecks; exact target update checked. |
| `normalize_task_comment_mentions(uuid[])` | `20261023130000` | invoker / immutable / internal | Pure normalization helper; no reads or writes. |
| `prepare_unassigned_task_reset(uuid, uuid, text)` | `20261021130000` | invoker / volatile / internal | Internal assignment helper; event/advisory/task serialization; exact reset update checked. |
| `reject_task_created_by_changes()` | `20261018120000` | invoker / volatile / internal | Trigger-only unconditional provenance immutability. |
| `reject_task_event_id_changes()` | `20261018120000` | invoker / volatile / internal | Trigger-only unconditional task-parent immutability. |
| `remove_task_work_link(uuid)` | `20261017150000` | definer / volatile / auth | Delegated active/current-real check; task→event locks; exact delete checked. |
| `restrict_assignee_task_updates()` | `20261022120000` | invoker / volatile / internal | Trigger-only; exact postgres-writer column allowlist and narrow raw-assignee status branch. |
| `revoke_archived_task_viewer(uuid, uuid)` | `20261023160000` | definer / volatile / auth | Active leadership before task→event locks, then recheck; exact delete checked. |
| `set_task_backup_request(uuid, boolean)` | `20261022120000` | definer / volatile / auth | Direct active/current-real check; task→event locks; exact task update checked; cleanup is intentionally set-based. |
| `set_task_confidentiality(uuid, boolean, uuid[])` | `20261021120000` | invoker / volatile / auth | Active-gated RLS and explicit caller check; event→task locks; exact update checked. |
| `set_task_dependency(uuid, uuid)` | `20261020120000` | definer / volatile / auth | Direct active/current-real check; event/advisory/task lock and fresh graph recheck; exact update checked. |
| `set_task_destination_lane_order()` | `20261020120000` | invoker / volatile / internal | Trigger-only; advisory serialization; caller branch remains narrow and owner branch allowlisted. |
| `task_comment_mentions_are_valid(uuid, uuid[])` | `20261023130000` | definer / volatile / internal | Internal validator; every target must be active with current real access. |
| `task_comment_trim_body(text)` | `20261023130000` | invoker / immutable / internal | Pure text helper; no reads or writes. |
| `task_content_access(uuid)` | `20261023120000` | definer / stable / internal | Caller wrapper over the user-aware evaluator; no direct client grant. |
| `task_content_access_for_user(uuid, uuid)` | `20261023160000` | definer / stable / internal | Active/profile existence is mandatory; one current decision covers ordinary and late access. |
| `task_dependency_allows_forward_move(uuid, uuid)` | `20261020120000` | definer / volatile / auth | Trigger-context-only helper; direct invocation fails before reading; fresh dependency state after lock. |
| `task_dependency_lock_key(uuid)` | `20261018120000` | invoker / immutable / auth | Pure lock-key calculation; returns no content. |
| `task_lane_tail_sort_order(uuid, text, text, uuid)` | `20261018130000` | definer / volatile / auth | Trigger-context-only helper; direct invocation fails; VOLATILE preserves post-wait snapshot. |
| `task_work_link_url_is_canonical(text)` | `20261017150000` | definer / immutable / internal | Pure canonical URL predicate; no reads or writes. |
| `unassign_self(uuid)` | `20261021130000` | definer / volatile / auth | Direct active/current-real check; event/advisory/task order; exact task update checked. |
| `validate_task_dependency()` | `20261018120000` | definer / volatile / internal | Trigger-only; shared advisory lock before fresh same-event/cycle validation. |
| `volunteer_for_task(uuid)` | `20261022120000` | definer / volatile / auth | Direct active/current-real check; task→event locks; unique offer insert. |
| `withdraw_task_volunteer(uuid)` | `20261022120000` | definer / volatile / auth | Direct active check; task→event locks; caller-only delete semantics. |

## Tables and RLS boundaries

| Table | Phase 4 relationship | RLS / authenticated privilege review | Integrity and archive review |
|---|---|---|---|
| `events` | Parent lifecycle table | RLS enabled; existing authenticated grants remain RLS-bound | Archive RPC is sole authenticated archive path; Archived freeze and Active-task deferred invariant retained. |
| `tasks` | Core Phase 4 table | RLS enabled; raw grants remain narrower than RPC content access | `event_id`/`created_by` immutable; dependency/order/assignment caps and archive freeze retained. |
| `task_work_links` | Step 4 child | RLS enabled; no authenticated table privilege; no permissive policy | Immutable `task_id`; task→event guard; Archived writes frozen. |
| `task_volunteers` | Step 8A child | RLS enabled; no authenticated table privilege; no permissive policy | Immutable row; task→event guard; Archived writes frozen. |
| `task_comments` | Step 9 child | RLS enabled; no authenticated table privilege; no permissive policy | Immutable parent/author; task→event guard; Archived writes frozen. |
| `archived_task_viewers` | Step 7B child | RLS enabled; no authenticated table privilege; no permissive policy | Archived-only rows; immutable parent/grantor; task→event guard. |
| `notifications` | Existing boundary | RLS enabled; owner read/update policies only | Phase 4 migrations and app flows create no notification rows. |
| `activity_log` | Existing boundary | RLS enabled; read policy only; no client write path | Trigger-only writes; current task visibility remains the authorization boundary. |

## Policies

The four Phase 4 replacements are marked **P4**. The remaining policies are included because they bound the same tables and the live query must expose policy drift.

| Policy | Command / role | Review |
|---|---|---|
| `events.events_select` | SELECT / public | Existing active leadership Draft and public lifecycle visibility retained. |
| `events.events_insert` | INSERT / public | Existing active leadership and server-derived creator checks retained. |
| `events.events_update` **P4** | UPDATE / public | Active leadership only; raw transition to Archived removed. |
| `events.events_delete` | DELETE / public | Active Admin only; Archived rows excluded. |
| `tasks.tasks_select` **P4** | SELECT / public | Every branch active-gated; backup/viewer/creator/late-share flags grant no raw access. |
| `tasks.tasks_insert` | INSERT / public | Existing active Admin/owning Co-Admin boundary retained. |
| `tasks.tasks_update` **P4** | UPDATE / public | Both `USING` and `WITH CHECK` active-gated; assignee raw branch remains status-only. |
| `tasks.tasks_delete` **P4** | DELETE / public | Active leadership only; creator and content-only viewers gain no right. |
| `notifications.notifications_select_own` | SELECT / public | Owner-only read boundary retained. |
| `notifications.notifications_update_own` | UPDATE / public | Owner-only read-state update retained. |
| `activity_log.activity_log_select` | SELECT / public | Access follows hardened current task visibility and hides confidential snapshots. |

## Triggers

All are expected enabled in origin mode. The three constraint triggers are expected deferrable and initially deferred.

| Trigger | Table | Timing | Review |
|---|---|---|---|
| `guard_event_updates` | `events` | BEFORE UPDATE OR DELETE, ROW | Permanent lifecycle freeze, including service-role writes. |
| `events_set_updated_at` | `events` | BEFORE UPDATE, ROW | Version timestamp attachment retained. |
| `events_guard_banner_url` | `events` | BEFORE INSERT OR UPDATE, ROW | Existing banner integrity boundary retained. |
| `events_require_task_when_inserted_active` | `events` | AFTER INSERT, deferred ROW | Active event must have a task at transaction end. |
| `tasks_activity_log` | `tasks` | AFTER INSERT OR UPDATE OR DELETE, ROW | Attached once; no-op/rank-only noise suppressed. |
| `tasks_restrict_assignee_updates` | `tasks` | BEFORE UPDATE, ROW | Current narrow caller/owner allowlists attached. |
| `tasks_guard_archived_event_writes` | `tasks` | BEFORE INSERT OR UPDATE OR DELETE, ROW | Parent lifecycle lock/recheck attached. |
| `tasks_preserve_active_event_task_on_delete` | `tasks` | AFTER DELETE, deferred ROW | Last-task removal checked at transaction end. |
| `tasks_preserve_active_event_task_on_event_move` | `tasks` | AFTER UPDATE OF `event_id`, deferred ROW | Defense retained despite unconditional reparent rejection. |
| `tasks_z3_assign_creation_metadata` | `tasks` | BEFORE INSERT, ROW | Server derives creator/rank. |
| `tasks_validate_dependency` | `tasks` | BEFORE INSERT OR dependency UPDATE, ROW | Same-event/self/cycle validation attached. |
| `tasks_guard_referenced_prerequisite_deletion` | `tasks` | BEFORE DELETE, ROW | Referenced prerequisites protected. |
| `tasks_z0_reject_event_id_changes` | `tasks` | BEFORE UPDATE OF `event_id`, ROW | Reparenting rejected before later Phase 4 update triggers. |
| `tasks_z1_reject_created_by_changes` | `tasks` | BEFORE UPDATE OF `created_by`, ROW | Provenance immutable. |
| `tasks_z2_set_destination_lane_order` | `tasks` | BEFORE lane/rank UPDATE, ROW | Destination rank serialization attached after guards. |
| `task_work_links_guard_writes` | `task_work_links` | BEFORE INSERT OR DELETE, ROW | Task→event access/archive guard. |
| `task_work_links_reject_updates` | `task_work_links` | BEFORE UPDATE, ROW | Child immutability guard. |
| `task_volunteers_guard_writes` | `task_volunteers` | BEFORE INSERT OR UPDATE OR DELETE, ROW | Task→event access/archive guard. |
| `task_comments_guard_writes` | `task_comments` | BEFORE INSERT OR UPDATE OR DELETE, ROW | Task→event access/archive and immutable-parent guard. |
| `archived_task_viewers_guard_writes` | `archived_task_viewers` | BEFORE INSERT OR UPDATE OR DELETE, ROW | Task→event Archived-only and immutable-parent guard. |

## Conclusion

The tracked migrations satisfy the Step 10A static review criteria: fixed paths, explicit execute boundaries, one signature per Phase 4 function name, active-user enforcement, documented lock orders, exact-one checks for targeted mutations, trigger attachment in source, narrow raw RLS, frozen Archived history, immutable task parents, and no ordinary task-flow service role. The owner ran the read-only catalog paste on Dev, and all five result sets matched: 57 functions, 8 tables, 11 policies, 20 triggers, and 0 overloads.
