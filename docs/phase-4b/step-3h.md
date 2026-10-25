# Step 3H: Home event progress

**Status:** Planned | **Branch:** `feature/home-event-progress` | **Reasoning level:** High

## Goal

Give each Home event card a lightweight summary of its current phase, task progress percentage, open backup requests, and Backlog count through a safe per-event reader. The summary must respect the caller's existing event and task access, Draft visibility, and confidential masking.

## Decisions

- Batch 3H runs after Batch 3P and before Batch 5.
- The batch needs a new tracked migration and an independent SQL test paste.
- Database and security work uses High reasoning.
- The owner must define what **current phase** means before the reader contract or implementation is finalized.

## Current state

- Home event cards use the existing RLS-scoped event query and do not receive phase, task-progress, backup-request, or Backlog aggregates.
- The event board already has confidential-safe task presentation and a server-owned Backlog definition, but Home must not load the fully populated Kanban reader merely to render four small summary values.
- Batch 3P owns Home paging and lands first; 3H must preserve its page boundaries, ordering, reset behavior, and lookahead contract.

## Scope: in / out

**In:** one lightweight safe per-event reader; current phase after the owner defines it; progress percentage; open backup-request count; Backlog count; Home card presentation; loading, empty, and safe failure states; a tracked migration; SQL security and result tests.

**Out:** Kanban paging or behavior; task mutations; phase-completion rules; new Home filters or sorting; changing event visibility; exposing task titles, descriptions, assignees, or confidential content; dashboard statistics beyond the four approved values.

## Database impact

A new migration is required. During Batch 3H planning, define one fixed-shape, fixed-search-path reader that derives the caller from `auth.uid()` and returns only the approved aggregate fields for an event the caller may see. Do not edit an applied migration or overload an existing function.

The final signature, owner, volatility, grants, and empty/error behavior must be specified after the owner resolves the current-phase definition and after the Home paging implementation from 3P is inspected.

## Guards that must remain true

- The reader returns no additional task content and cannot be used to infer confidential titles, descriptions, assignees, or hidden task membership.
- Event access and Draft visibility remain no broader than the existing caller-visible Home event set.
- Progress, backup, and Backlog definitions use authoritative server rules rather than client reconstruction.
- Batch 3P paging, ordering, 21-row lookahead, deduplication, and reset behavior remain unchanged.
- Home cards do not invoke the fully loaded Kanban reader.
- No writer, mutation payload, task permission, RLS policy, polling contract, or board data shape changes.

## Security risks

- Aggregate counts can leak the existence or lifecycle of tasks the caller must not be able to infer. SQL tests must cover Admin, Co-Admin, Member, inactive, profile-less, Draft, Active, Archived, confidential, masked, and hidden paths.
- A caller-supplied event id must never substitute for an authorization check. The reader must derive the caller and independently prove visibility.
- Current-phase and percentage calculations must not reveal masked task content through labels or inconsistent totals.
- Grants, function ownership, `search_path`, volatility, and overload counts require catalog assertions.

## Test deliverable

Create `docs/phase-4b/step-3h-tests.md` with one rollback-safe Dev SQL paste. Cover authorization and inactive/profile-less denial; Draft visibility; confidential real/masked/hidden cases; zero-task, all-Backlog, partial, and fully completed events; open versus closed backup requests; deterministic current-phase results; fixed output shape; grants and catalog properties; and absence of overloads.

Add focused application tests for result validation, percentage/count rendering, safe reader failure, and preservation of Batch 3P paging behavior. Re-run the relevant event/task catalog and confidentiality regressions identified during implementation.

## Manual checklist

- Test Home as Admin, Co-Admin, and Member at phone and desktop widths in both themes.
- Verify Draft, Active, and inaccessible events retain their existing visibility.
- Compare every displayed percentage, Backlog count, and open backup count with authoritative event-board/task state.
- Verify confidential tasks do not expose content or create role-dependent information leaks beyond the approved aggregate contract.
- Verify Home paging, Load more, ordering, links, menus, loading, empty, and error states remain correct after 3P.

## Acceptance

Home event cards show the four approved summary values through one lightweight safe reader without loading Kanban data or widening access. The tracked migration and SQL tests prove RLS-equivalent event visibility, Draft handling, confidential safety, fixed shape, grants, and catalog properties. Batch 3P behavior and every existing mutation contract remain unchanged.

## Open question for the owner

- What exactly does **current phase** mean when phases are unphased, empty, partially complete, completed out of order, or have tasks progressing in more than one phase? This must be resolved before the reader contract is designed.

## Docs to update when this lands

- Add the final reader contract and migration order to `docs/DATABASE.md`.
- Add implementation and verification results to this file and `docs/PROGRESS.md`.
- Create `docs/phase-4b/step-3h-tests.md` and update any earlier catalog allowlists affected by the new function.
