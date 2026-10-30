# Batch 13e — all-committee Archived-template import

Status: implemented locally on `fix/template-import-all-committees`; not applied or verified on Dev.

## Outcome and boundary

An Admin keeps the existing `create_event_with_tasks` path. An active Co-Admin creating from an Archived template uses the sole new public RPC, `create_event_from_archived_template(text,text,date,date,text,uuid,jsonb,jsonb)`. The client submits only editable own-committee drafts plus opaque source-task UUID exclusions. The server re-derives every retained, non-confidential, other-committee row from the locked source event. This is a narrow template copier, not a general cross-committee task writer.

Imported rows retain `committee_id`, title, description, phase, priority, type, and null-preserving integer-day-shifted dates. They always start `To Do`, unassigned, non-confidential, with no backup request, dependency, or allowed viewers. Other-committee preview cards are read-only except that a Co-Admin may remove them; removal sends only the source UUID exclusion. Own-committee preview rows remain editable and are ordinary submitted drafts.

## Reader replacement: old and new

The signature and five-column `RETURNS TABLE` shape are unchanged, so `CREATE OR REPLACE` is valid and no drop or overload is needed.

| Property | Old definition | Batch 13e definition | Behavior difference |
|---|---|---|---|
| execution | `SECURITY INVOKER`, empty path | `SECURITY DEFINER`, postgres owner, empty path | The body can deliberately read all source committees, so it explicitly rechecks the caller. |
| caller | active Admin/Co-Admin | same | Anonymous, profile-less, inactive, Member, and other roles receive no template data. |
| non-confidential task scope | Admin: RLS-visible rows; Co-Admin: explicit own committee | every source committee | Co-Admin preview now includes all non-confidential rows. |
| confidential scope | same caller/RLS committee scope | all source committees, aggregate only | Co-Admin sees one skipped total. This is the recommended safe rule: never return confidential ids, committees, phases, titles, descriptions, or schedules. |
| task JSON | no source token | same fields plus `source_task_id` | The UUID is an opaque exclusion token, not a writable task payload. |
| status/assignees/date shift | `To Do`, empty, integer-day and null-preserving | unchanged | None. |
| result shape/cap | five columns; 200 importable tasks | unchanged | No overload and no return-shape change. |

## Assignee guard replacement: old and new

Only one allowlist literal changes; the trigger algorithm is otherwise identical.

```sql
-- old
v_writer text := coalesce(current_setting(
  'ceit_connect.task_assignee_writer', true
), '');
v_trusted boolean := current_user = 'postgres'
  and coalesce(v_writer, '') in (
    'create_event_with_tasks',
    'edit_event_with_tasks',
    'assign_task_people', 'unassign_self', 'claim_task',
    'accept_task_volunteer', 'create_active_event_task',
    'edit_active_event_task'
  );

-- new
v_writer text := coalesce(pg_catalog.current_setting(
  'ceit_connect.task_assignee_writer', true
), '');
v_trusted boolean := current_user = 'postgres'
  and coalesce(v_writer, '') in (
    'create_event_with_tasks',
    'create_event_from_archived_template',
    'edit_event_with_tasks',
    'assign_task_people', 'unassign_self', 'claim_task',
    'accept_task_volunteer', 'create_active_event_task',
    'edit_active_event_task'
  );
```

Behavior differences: only the exact marker `create_event_from_archived_template` is newly trusted. Missing settings still normalize null-safely through plain `coalesce(..., '')`; `current_setting` remains `pg_catalog`-qualified. A forged marker under any non-postgres effective user remains untrusted; self-assignment, overlap, and volunteer checks are unchanged.

## Writer design and validation

The public RPC is postgres-owned, `VOLATILE SECURITY DEFINER`, fixed empty path, granted only to `authenticated`; `PUBLIC` and `anon` are revoked. The internal `copy_archived_template_tasks(uuid,uuid,date,uuid[])` has the same owner/path but is revoked from `PUBLIC`, `anon`, and `authenticated`.

Before any lock, the public function derives the caller only from `auth.uid()` and requires an active Co-Admin with a non-null committee. Admin, Member, inactive, profile-less, and anonymous callers receive fixed safe errors. It then performs lock-free shape and availability checks. Because postgres execution bypasses task RLS, own-draft validation explicitly restates:

1. every task is a JSON object; title, optional description, and phase have the same types, trimming, and length limits;
2. `committee_id` is a UUID string exactly equal to the caller's committee;
3. type and priority are existing enum values;
4. due date and call/end timestamps have the existing types and parse rules; end must not precede call, including across dates;
5. `assignee_ids` is required, has at most 100 unique valid UUIDs, and every assignee currently exists and is active;
6. status, confidentiality, viewers, backup, dependency, split assignee arrays, creator, and event id are never accepted from the payload: inserts force `To Do`, false/empty/null values and derive the caller/event;
7. event name/description/date/status validation matches creation; Active requires an end date and at least one final task;
8. the authoritative 200 cap is own drafts plus retained server-derived foreign rows.

Reusing `create_event_with_tasks` is unsafe here. Its Co-Admin task rule rejects the deliberate foreign rows, and passing only own rows would make its Active non-empty check and 200 cap blind to copied rows. It would also insert the event before a separate copier, breaking the required single atomic transaction. The new boundary therefore mirrors its validation while retaining the existing function unchanged.

Own drafts with assignees do need `ceit_connect.task_assignee_writer`, because the guard sees non-empty `primary_assignees`. The public writer sets that marker transaction-locally only immediately around those task inserts, only when at least one submitted assignee exists, and requires the effective postgres identity through the guard. It clears the marker before calling the copier; copied rows have empty arrays and need no marker. Success and exception cleanup are catalog/body pinned. No `task_access_writer` marker is needed because all inserted access fields are false/empty, and no other `ceit_connect.*` marker is set.

## Lock order and concurrency

Authorization precedes every lock. The authoritative order is:

1. sorted Step 10 assignee-user locks;
2. `FOR SHARE` on the existing Archived source event;
3. per-creator Draft-cap advisory lock;
4. destination insert triggers and existing event/task locks.

Both the Draft cap and combined 200-task cap run after the creator-cap lock. The source row is rechecked as Archived under `FOR SHARE`; a missing/deleted/non-Archived source produces the fixed unavailable error and the transaction creates nothing. Batch 13d's future event deletion must lock that same event row before deleting its children and must not acquire assignee-user or creator-cap locks after it. Thus import and deletion serialize on the source event without taking the shared resources in opposite order. The Step 13e test pins the order from the function body; two-session outcomes are represented by body/catalog assertions rather than a fake single-session race.

## Client flow and proof of payload limits

The preview always comes from `get_archived_event_template`. UUIDs are validated with `src/lib/uuid.ts`, normalized, deduplicated, and capped at 200. A Co-Admin can edit only own-committee cards. Removing another committee's card records its source UUID; keeping it sends nothing. Switching the starting-point display back to Scratch does not clear or hide the applied-template banner or Task Setup cards: the visible imported rows and exclusions remain authoritative until a new import replaces them, and the Co-Admin still saves through the template RPC. Admin behavior remains on the existing ordinary writer. At save, the client sends own editable drafts plus exclusions. The server ignores valid exclusions not belonging to the source and ignores own-committee exclusions. Foreign rows are selected only from `tasks where event_id = locked template`, so client JSON cannot add, rename, reschedule, reassign, change committee, or make a foreign row confidential. Exclusions can only reduce the copied set.

The existing database validator accepts a Live Operation whose end timestamp is on a later date: it parses both timestamps and rejects only `end_time < call_time`; it never requires equal dates. Batch 13e therefore preserves and exposes separate call/end dates. When a user newly adds or explicitly edits a task, choosing an end date now requires an end time before that task can be applied to form state; the chronological check still runs when both timestamps exist. This does not run during an unrelated Edit Event save, so untouched stored tasks are not newly blocked. Due dates follow the form's Manila calendar rule: a date-only own value stays that date, while a server timestamp is converted to `Asia/Manila` before taking its calendar date—never plain UTC slicing. These are explicit tested behavior changes for both Admin and Co-Admin imports.

Each copied insert uses the normal task INSERT trigger path. Its Batch 12 activity snapshot contains the new event/task ids, original public task fields, `To Do`, empty assignees, and non-confidential access state; it never stores the source UUID or confidential source content. Batch 12's leadership reader may show the normal non-confidential INSERT record; Member scoping remains unchanged and no confidential row is copied to log.

## Verification and documentation

Run [step-13e-tests.md](./step-13e-tests.md) on Dev after manually applying the migration. Expected result-line count: **72**. After it passes, update application status in `DATABASE.md`, `ARCHITECTURE.md`, and `PROGRESS.md`, and carry the three new functions plus the exact assignee marker into the Phase 4B/Batch 14 catalog allowlists.

The Dev fixture performs a direct postgres-dashboard `UPDATE public.events` from Active to Archived after inserting its tasks. `guard_event_updates` permits that exact lifecycle transition, while the archived-task guard would reject inserting the rows after archival. The transaction sets `timezone` to `Asia/Manila` transaction-locally with `set_config`. Repository migration contracts strip SQL comments and reject exactly `\bpg_catalog\.coalesce\s*\(` and `\bif\s+case\b`; therefore `if (case ... end) then` remains allowed.
