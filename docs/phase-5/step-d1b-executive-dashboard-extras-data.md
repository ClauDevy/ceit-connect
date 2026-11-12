# D1b Executive Dashboard extra data readers

D1b is database-only. Migration
`20261114120000_executive_dashboard_extras_data.sql` adds six authenticated
public readers and one ungranted private classifier. It adds no table, index,
policy, trigger, foreign key, writer, service-role path, UI, route, or
application code, and it replaces no existing function.

## Existing deadline contract

The real type of `public.tasks.due_date` is `timestamptz`.
`public.calculate_effective_task_priority(text,timestamptz,timestamptz,text)`,
which is used by `list_my_tasks` and the existing board/detail/help readers,
promotes every incomplete overdue task when `due_date < as_of`. Its 24-hour
branch promotes only stored `Low`/`Medium` priorities when
`due_date <= as_of + interval '24 hours'`; the existing readers do not expose a
separate due-soon boolean. Completed tasks keep their stored priority. The
readers agree with one another because they call that same helper.

D1b preserves those edges and makes the two dashboard categories mutually
exclusive and counts every stored priority: due in 24 hours additionally
requires `due_date >= as_of`. At risk means a `To Do` task with
`due_date > as_of + 24 hours` and
`due_date <= as_of + 48 hours`. Public readers derive one `as_of` from
`statement_timestamp()`; the browser never supplies it.

R2 later uses that same exact stored `due_date` instant for its 24-hour
`task_due_soon` window, but remains a separate write path: it requires the
target to be strictly after its controlled run clock, targets active current
primary/assist assignees, and records per-person delivery in its private
ledger. D1b keeps reading task/event state only and neither reads nor writes R2
notifications or ledger rows. An unassigned task therefore still appears in
the needs-attention data while R2 correctly has nobody to notify. R2's separate
two-hour Live Operation rule reads `call_time`; D1b and the existing priority
classifier remain due-date-only, and `end_time` triggers nothing.

## Private classification

`ceit_connect_private.classify_executive_dashboard_task(
p_due_date timestamptz, p_status text, p_as_of timestamptz)` returns exactly
four fields: overdue, due in 24 hours, at risk, and bucket. The only allowed
bucket values are:

- `Overdue`
- `Due in 24 hours`
- `In Progress`
- `To Do`
- `Completed`

It performs no authorization and has no application-role execute grant. Its
clock argument exists so the owner-run SQL paste can prove exact boundaries.

## Scope and authorization

The five scoped readers take `p_committee_id uuid default null`. Omission is
council scope and is allowed only for an active Admin. An active Admin may also
select any existing committee. An active Co-Admin must pass their own existing
committee UUID; omission, another committee, or a missing committee receives
SQLSTATE `42501` and `Executive Dashboard access denied.` D2 must therefore
always pass the signed-in Co-Admin's committee UUID. Members, inactive callers,
and profile-less callers receive the same fixed denial. `anon` and
`service_role` have no execute grant. Push adoption is active-Admin-only.

Every reader authorizes before aggregation. No D1b function takes an explicit
row, advisory, or table lock.

## Reader contracts

- `get_executive_dashboard_extras_overview(uuid)` returns open, overdue, due
  in 24 hours, unassigned, help wanted, and needs-approval KPIs plus five donut
  counts. Open comes from D1's unchanged private committee aggregate. Donut
  precedence is Overdue, Due in 24 hours, In Progress/To Do, then Completed;
  Completed counts only tasks in Active events.
- Needs approval counts an assigned requester's pending leave row and each
  still-valid volunteer offer separately. A valid volunteer is active, still
  unassigned to the task, and offering on an incomplete Active-event task
  which still requests backup.
- `list_executive_dashboard_needs_attention(uuid)` returns at most 20 rows.
  Task rows use only their most urgent category. Approval rows remain separate
  and expose no person names. Order is overdue, due in 24 hours, needs
  approval, help wanted, needs a new owner, unassigned; then deadline ascending
  with nulls last, source creation time, source kind, task UUID, and source UUID.
  The cap is applied only after that complete order. Confidential task rows use
  `Confidential task`; approval rows use `Leave request` or `Volunteer offer`;
  all confidential rows have a null task UUID.
- `list_executive_dashboard_deadlines(uuid)` returns today through six days
  later as Asia/Manila calendar dates, including zero days. It counts open
  tasks by their Manila due-date day, so an earlier overdue time today remains
  on today's bar.
- `list_executive_dashboard_free_members(uuid)` lists active Co-Admins and
  Members only. Scope selects people, while each workload is their distinct
  council-wide Active-event, non-Completed assignment count. Only counts zero
  through two are returned, ordered by count, full name, and UUID, with no cap.
- `list_executive_dashboard_member_slipping_signals(uuid)` uses the D1 member
  population and counts only tasks owned by that member's committee. It returns
  open, overdue, and at-risk counts, ordered by committee name, member name,
  and member UUID.
- `get_executive_dashboard_push_adoption()` counts every active profile once
  when they own at least one subscription whose `expires_at` is null or later
  than `as_of`. It returns only adopted and total counts; no identity, endpoint,
  key, device, or subscription data is returned.

Draft and Archived events never count. Null deadlines remain open, use the
task's In Progress/To Do donut bucket, and never enter time-sensitive counts or
deadline bars. Deactivated-only assignments need a new owner; an active
cross-committee assignee prevents that category but creates no local D1 member
bar. Zero-task committees and members retain fixed zero outputs. A committee
with no Co-Admin remains readable by Admins.

## Verification and rollout

1. Review the full migration and both SQL test documents.
2. Run `npx supabase projects list` and confirm the linked project is Dev.
3. Run `npx supabase db push --dry-run` and confirm it lists exactly
   `20261114120000_executive_dashboard_extras_data.sql`.
4. Run `npx supabase db push` to apply that migration to Dev.
5. In the Dev SQL Editor use **Run without RLS** and run the single paste in
   `step-d1b-executive-dashboard-extras-behaviour-tests.md`.
6. Run `step-d1b-executive-dashboard-extras-catalog-tests.md` the same way.
7. Both final exceptions are intentional rollback sentinels. After both Dev
   pastes pass, commit, open the PR, and merge it. Apply the reviewed migration
   to Prod only after the PR is merged.

No application or browser test belongs to D1b. D2 owns the UI, motion, and
reduced-motion work.
