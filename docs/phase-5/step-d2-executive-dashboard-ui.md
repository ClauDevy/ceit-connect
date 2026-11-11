# D2 Executive Dashboard UI

D2 is application and UI code only. It adds no migration, database function,
API route, dependency, service-role path, or URL-carried private state.

## Reader boundary

The initial page load calls all applicable readers in the Server Component with
the normal server Supabase client, which carries only the signed-in user's
session. Admin council scope calls the D1 committee totals, the four council-
scoped D1b readers, and Admin-only push adoption. A Co-Admin initial load calls
the three Level 2 readers and the four D1b readers with that Co-Admin's committee
UUID. A Co-Admin without a committee receives the safe denial before a client is
created and before any RPC runs.

After hydration, drill-down, manual Refresh, and stale-cache refresh call the
same authenticated RPCs directly with the browser Supabase client and the same
signed-in session. There is no service role, API route, secret, or committee ID
in the URL. Push adoption is shown and refreshed only for an Admin's council
view.

## UI and safety contract

- Level 1 sleeping state comes only from every returned committee total being
  zero. Level 2 sleeping state comes only from the summary's explicit unique
  active-task count.
- Member bars preserve D1 order and pair D1b signals by member UUID. Missing or
  failed signals never invent zero chips and never hide the D1 member bars.
- Bar labels remain the exact reader values. Relative lengths use only the
  largest value in that panel with a minimum denominator of one.
- The no-bar note uses only `out_tasks_without_member_bar_count`.
- Donut values, legend numbers, and done percentage use only the five returned
  donut fields. A zero total says `No tasks`.
- Deadline calendar dates are split from their `YYYY-MM-DD` text. They are never
  passed through `Date` or timezone conversion.
- Non-confidential and approval attention rows open the existing
  `/tasks/[taskId]` route. Confidential and malformed targets are plain text.
- Fixed dashboard denial becomes a safe access-denied state. Other failures are
  isolated by section. No raw error, task, member, or reader payload is logged.

## Motion contract rows

`docs/DESIGN-SYSTEM.md`, under **Motion kit and rules for new pages**, requires
every Executive Dashboard UI to use the shared kit, document normal and reduced
motion, and add an automated contract row plus a manual browser row.

| Automated contract row | Expected result | Result |
| --- | --- | --- |
| Dashboard bars and SVG status ring use `ChartBarGrow` / `useVisibilityAnimation`, the shared 40% threshold and 1100 ms duration; reader numbers remain visible; cached scopes do not replay. | Pure, render, interaction, stale-response, stale-cache, accessibility, and shared motion-contract tests pass. | Passed in the full 126-file, 1,284-test run. |

| Manual browser row | Normal motion result | Reduced-motion result |
| --- | --- | --- |
| Admin council → committee → Back; scroll committee/member/deadline bars and donut through 40% visibility; Refresh and revisit cached scopes. | Each newly opened scope fills once over 1100 ms. Labels remain readable; refresh and cached revisits do not replay. | Final values appear immediately with no fill, ring, spin, or spatial animation. Owner browser verification pending. |

## Manual acceptance checklist

1. Admin sees council KPIs, all committees, council extras, and push adoption;
   push adoption disappears in committee scope.
2. Co-Admin lands on their own Level 2 with no Back/All committees control.
3. Member has no dashboard navigation and direct `/dashboard` access returns
   Home.
4. Verify sleeping states, explicit no-bar note, shared-task bar totals, missing
   signals, seven Manila calendar dates, and all-zero deadlines.
5. Verify confidential rows never link and approval rows open only their task.
6. Verify broken avatars fall back to initials, committee buttons are keyboard
   reachable, and bars/donut have readable text alternatives.
7. Verify status colors match between KPI/legend/ring in light and dark themes.
8. Verify fast committee switching cannot show the earlier selection, then
   verify stale cached content appears immediately and refreshes quietly.
