# Step 9A — Tasks personal feed (Workspace)

**Status:** Optional.

- Add the **My Tasks** tab to the existing **Tasks** page at `/workspace`, using the relevant searched sections of `tasks.html`. List the active caller's primary and assist assignments across Active events, with status, priority, and deadline filters and links that open the shared task detail page. Help Wanted remains the Step 8 tab rather than being reimplemented here.
- Use a restricted, fixed-shape personal-feed RPC that derives `auth.uid()`; never accept a user id selecting whose feed to read. Because the caller is an assignee, confidential assignments return real content under the normal current-access rule. Draft tasks remain leadership-only and Archived tasks stay in Archives rather than the active Workspace feed.
- Refetch on window focus and short-poll only while visible, using the event board's freshness policy. Do not add task Realtime or Executive Dashboard queries.
- **Database impact:** reads `events`, assigned `tasks`, and safe related metadata. No columns change. New migration: **yes**, for the restricted personal-feed RPC and grant. Raw task RLS stays unchanged.
- **Guards that must remain true:** the function cannot enumerate another user's assignments; confidential access comes from an actual current assignment; Draft and Archived boundaries remain intact; the feed writes nothing and cannot affect the Active-event invariant.
- **Security risks:** never trust a requested user id, role, cached assignment, or client filter. Fix the search path, derive/re-check the active caller, cap and page results, return a fixed shape, and check errors so a denied or partial feed is not presented as complete.
- **Test deliverable:** `docs/PHASE-4-STEP-9A-TESTS.md` follows the global test contract and proves caller-only primary/assist results, confidential assignment visibility, Draft/Archived exclusions, inactive denial, pagination, and no raw-policy broadening; manual checks cover filters, modal links, focus refetch, and polling.
- **Acceptance:** each active user sees only their current Active-event assignments, including confidential tasks assigned to them; no caller can request another user's feed; filters and modal links work; another user's assignment change appears after focus or the polling interval without Realtime.

[Back to Phase 4 index](../PHASE-4-PLAN.md)
