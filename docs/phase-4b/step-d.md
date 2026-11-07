# Phase 4B Batch D — automatic event archive

## Approved behavior

An Active event keeps its normal manual archive behavior. Separately, it becomes eligible for automatic archive only after three **complete Asia/Manila calendar days** have passed after `end_date`. An event ending October 10 stays Active through October 13 and becomes eligible at 12:00 a.m. Manila on October 14. An Active event with a null end date is legacy-invalid: the runner skips it, the UI shows no warning, and it can still be edited or archived manually. Draft→Active still requires an end date. For an already-Active event, Batch D rejects only changing an existing non-null end date to null; it does not retroactively reject edits to a legacy null-end row.

The warning is visible only after the end date and uses warning-style `InlineAlert`. Owner-approved text B is: `This event archives automatically in 2 days. 4 tasks are unfinished.` Admin and Co-Admin append: `Edit the event to extend its end date.` Use `1 day`, `1 task is unfinished`, say `today` instead of `in 0 days`, omit the unfinished-task sentence when the count is zero, and never expose task names. The count includes confidential tasks as a **number only**; confidentiality does not remove a task from the aggregate.

Every Active→Archived transition stores `events.archived_unfinished_task_count` at transition time. The count is the number of tasks whose status is not `Completed`. The owner deliberately changed the earlier “old Archives keep null” option: the migration computes the same exact count once for every old manually Archived event. This is safe because Archived tasks are frozen; during the one backfill update, `guard_event_updates` and `events_set_updated_at` are disabled, so the Archived freeze does not reject the write, `updated_at` does not change, and there is no event audit trigger to emit an audit row. The lifecycle CHECK depends on this backfill: every Archived row must have a non-null count and every non-Archived row must keep null. Consequently, an ordinary direct insert of an Archived event without the stored count is no longer possible. The migration briefly locks `events` while altering it and backfilling, so Prod application should happen in a quiet moment. Manual archive validation and activity behavior otherwise stay unchanged.

## Database design

Migration: `supabase/migrations/20261108120000_event_auto_archive.sql`

- `event_auto_archive_grace_days()` fixes the grace at 3.
- `event_auto_archive_run_retention_days()` fixes private operational history at 30 days, matching Batch 12b's window. Each purge deletes at most 500 oldest runs; item rows cascade only from their run.
- `events_y0_capture_archive_snapshot` runs before event guards, but only for `Active → Archived` status updates.
- `get_event_auto_archive_warning(uuid)` admits active authenticated Admin, Co-Admin, and Member profiles, returns Active post-end-date warnings only, and counts all unfinished tasks without names.
- `auto_archive_one_event(uuid,date)` locks and rechecks one candidate. A concurrent end-date extension wins and returns `skipped`.
- `run_event_auto_archive()` is callable only by a real `postgres` session, uses one transaction advisory lock, orders by `end_date,id`, and attempts at most 100 events. Each item has its own exception block.
- The attempted counter increments before the item sub-block. The archived/skipped counter increments only after its run-item insert succeeds; the exception handler adds exactly one failed item and one failed count. Therefore every completed run preserves `attempted = archived + skipped + failed`, even if an item insert itself fails.
- Run records and item records are private. `event_auto_archive_run_items.event_id` is a plain UUID with **no event foreign key**, so operational history survives later event deletion and does not enter the CCE09 deletion inventory.
- Failures retain only SQLSTATE and the fixed text `Automatic archive failed.` Retention failures retain only SQLSTATE and `Run-history retention failed.` Names and task titles are never stored.
- Successful automatic transitions write the leadership activity `event_auto_archived` with a system actor and only statuses plus the stored count.

### Locking proof for the snapshot

The runner selects the event `FOR UPDATE SKIP LOCKED` inside `auto_archive_one_event` before it checks eligibility and updates status. The current task-write guard is `public.guard_archived_event_task_writes()` in `20261031140000_completed_phase_freeze.sql`; its parent-event query takes `FOR SHARE NOWAIT` at [line 275](../../supabase/migrations/20261031140000_completed_phase_freeze.sql#L275). PostgreSQL row-level `FOR SHARE` conflicts with the runner's `FOR UPDATE`, so no task writer can change the event's tasks while the runner owns that event row. The Active→Archived snapshot trigger runs during the runner's subsequent status update, after that row lock is already held. Its unfinished count therefore observes a task set protected from concurrent task writes.

## Latest `guard_event_updates()` — old versus new

This comparison is against the latest body from Batch 13d, `20261031130000_event_deletion.sql`. The new definition preserves that body and revoke list exactly except for the single narrow end-date clause shown below.

| Old latest guard | New Batch D guard |
|---|---|
| DELETE requires the private deletion-service context (`CCE01`) and permits only Draft/Archived (`CCE04`). | Unchanged. |
| Draft→Active has its plain null-end exception and task-existence check. | Unchanged, including its existing message and no custom SQLSTATE. |
| Existing Active rows have no end-date edit check. | Adds only: old/new status both Active, old end date non-null, new end date null → `CCD06`. |
| Legacy Active rows already having a null end date remain editable and manually archivable. | Unchanged because `old.end_date is not null` is false. |
| Revoke includes `ceit_event_delete_executor`. | Unchanged. |

Old latest body:

```sql
create or replace function public.guard_event_updates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if TG_OP = 'DELETE' then
    if not ceit_connect_private.event_delete_context_matches(old.id) then
      raise exception using
        errcode = 'CCE01',
        message = 'Events can be deleted only through the event deletion service.';
    end if;

    if old.status not in ('Draft', 'Archived') then
      raise exception using
        errcode = 'CCE04',
        message = 'Only Draft or Archived events can be deleted.';
    end if;

    delete from public.tasks
    where event_id = old.id;

    return old;
  end if;

  if old.status = 'Archived' then
    raise exception 'Archived events are read-only.';
  end if;

  if new.created_by is distinct from old.created_by then
    raise exception 'An event''s created_by cannot be changed.';
  end if;

  if old.status = 'Active' and new.status = 'Draft' then
    raise exception 'An Active event cannot be changed back to Draft.';
  end if;

  if new.status = 'Archived' and old.status <> 'Active' then
    raise exception 'Only Active events can be archived.';
  end if;

  if old.status = 'Draft' and new.status = 'Active' then
    if new.end_date is null then
      raise exception 'An Active event requires an end date.';
    end if;

    if not exists (
      select 1
      from public.tasks
      where event_id = old.id
    ) then
      raise exception 'An event requires at least one task before it can be launched.';
    end if;
  end if;

  return new;
end;
$$;

alter function public.guard_event_updates() owner to postgres;
revoke all on function public.guard_event_updates()
from public, anon, authenticated, service_role, ceit_event_delete_executor;
```

New Batch D body:

```sql
create or replace function public.guard_event_updates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if TG_OP = 'DELETE' then
    if not ceit_connect_private.event_delete_context_matches(old.id) then
      raise exception using
        errcode = 'CCE01',
        message = 'Events can be deleted only through the event deletion service.';
    end if;

    if old.status not in ('Draft', 'Archived') then
      raise exception using
        errcode = 'CCE04',
        message = 'Only Draft or Archived events can be deleted.';
    end if;

    delete from public.tasks
    where event_id = old.id;

    return old;
  end if;

  if old.status = 'Archived' then
    raise exception 'Archived events are read-only.';
  end if;

  if new.created_by is distinct from old.created_by then
    raise exception 'An event''s created_by cannot be changed.';
  end if;

  if old.status = 'Active' and new.status = 'Draft' then
    raise exception 'An Active event cannot be changed back to Draft.';
  end if;

  if new.status = 'Archived' and old.status <> 'Active' then
    raise exception 'Only Active events can be archived.';
  end if;

  if old.status = 'Active'
     and new.status = 'Active'
     and old.end_date is not null
     and new.end_date is null then
    raise exception using
      errcode = 'CCD06',
      message = 'An Active event requires an end date.';
  end if;

  if old.status = 'Draft' and new.status = 'Active' then
    if new.end_date is null then
      raise exception 'An Active event requires an end date.';
    end if;

    if not exists (
      select 1
      from public.tasks
      where event_id = old.id
    ) then
      raise exception 'An event requires at least one task before it can be launched.';
    end if;
  end if;

  return new;
end;
$$;

alter function public.guard_event_updates() owner to postgres;
revoke all on function public.guard_event_updates()
from public, anon, authenticated, service_role, ceit_event_delete_executor;
```

## `events` BEFORE-trigger order

Postgres runs same-kind triggers alphabetically. The new name intentionally places the snapshot after ordinary timestamp assignment and before the pre-existing end-shortening and lifecycle guards.

| Order | Before Batch D | After Batch D |
|---:|---|---|
| 1 | `events_enforce_creator_draft_cap` | `events_enforce_creator_draft_cap` |
| 2 | `events_guard_banner_url` (when installed) | `events_guard_banner_url` (when installed) |
| 3 | `events_set_updated_at` | `events_set_updated_at` |
| 4 | `events_z0_guard_end_shortening` (when installed) | `events_y0_capture_archive_snapshot` — only Active→Archived |
| 5 | `guard_event_updates` | `events_z0_guard_end_shortening` (when installed) |
| 6 | — | `guard_event_updates` |

The verification paste proves behavior rather than searching function bodies: Active and Draft metadata edits leave the snapshot null, an Active→Archived transition populates it, the stricter lifecycle constraint accepts the trigger-owned value, and a manual archive's live unfinished count equals its stored count.

## Production preview and rollout

Run this read-only query on Prod before scheduling. It uses the same eligibility rule and order as the runner and returns no task names:

```sql
select
  event_row.id,
  event_row.end_date,
  event_row.end_date + public.event_auto_archive_grace_days() + 1 as archive_on,
  count(task_row.id) filter (where task_row.status <> 'Completed') as unfinished_task_count
from public.events as event_row
left join public.tasks as task_row on task_row.event_id = event_row.id
where event_row.status = 'Active'
  and event_row.end_date is not null
  and (timezone('Asia/Manila', statement_timestamp()))::date
      > event_row.end_date + public.event_auto_archive_grace_days()
group by event_row.id, event_row.end_date
order by event_row.end_date, event_row.id;
```

Recommended backlog handling: review this list first and correct any genuinely wrong end dates. Then, during a quiet window, invoke `select * from public.run_event_auto_archive();` repeatedly as the dashboard SQL owner until `out_eligible_count` reaches zero, checking private run totals after each 100-row batch. Only then create the daily job. This makes the initial archive wave deliberate instead of letting the first cron invocation surprise the team.

Prod-only schedule, created manually after the backlog gate:

```sql
select cron.schedule(
  'ceit-connect-event-auto-archive',
  '5 16 * * *',
  $$select * from public.run_event_auto_archive();$$
);
```

`pg_cron` evaluates this expression in UTC. `16:05 UTC` is `00:05 Asia/Manila` on the following calendar day, so the job runs shortly after Manila midnight. Do not create this job on Dev.

## Verification

`step-d-tests.md` contains one 46-line Dev paste. In addition to catalog/grant checks, it behavior-tests warning boundaries at 3/1/0 days and absence on the end date/Draft/Archived, confidential aggregate counting, active Co-Admin and inactive-profile handling, a real authenticated-role runner refusal, per-event extension-wins, the narrow Active non-null→null rejection, legacy null-end edit plus manual archive, same-save end-date/task-date movement with a still-null snapshot, contextless postgres DELETE rejection, deletion-service Active rejection, a successful Draft service deletion, anonymous-cron pending-leave cancellation, snapshot semantics, exact manual count, run-item survival, invariant-safe run totals, and the exact 100-attempt cap. All event dates use years 1000–1100 so real Dev rows cannot take fixture positions under the cap.

## App implementation

The Active board is explicitly dynamic and calls `get_event_auto_archive_warning(uuid)` only after its server query has admitted an Active event. A valid one-row aggregate becomes a shared warning-style `InlineAlert`; a missing row shows nothing. RPC failures log only a fixed context plus SQLSTATE and do not block the board. The server-derived profile role controls whether the extension sentence appears. Exact copy is plural-aware, says `today` at zero days, omits the unfinished sentence at zero tasks, and never receives or renders task names.

Event Archives reads `archived_unfinished_task_count` in both the initial and paged queries. A warning-toned text badge beside `Archived` says `1 unfinished task` or `N unfinished tasks`; zero and null render no badge. Mobile titles stay on one truncated line.

Edit Event keeps Draft end dates optional until launch. An Active event with an existing end date gets a friendly client check if that date is cleared, while `CCD06` remains the database-authority fallback with the same fixed message. A legacy Active event that started with a null end date can still save unrelated edits while blank or acquire an end date; it receives no client error for remaining blank.

Activity Log already renders the Batch D reader's `Event archived automatically` summary and `System` actor. The page's active-profile Admin/Co-Admin guard rejects both Members and inactive Admins before creating its data client. Automated app coverage pins the warning parser/copy, warning variant, archive label visibility, end-date exception and fallback, fresh Active-only RPC placement, System rendering, and both denied Activity Log cases.
