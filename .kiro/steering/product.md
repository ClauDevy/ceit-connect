# Product Overview — CEIT Connect

(Core rules live in the root `AGENTS.md`, which Kiro always loads. This file is only the product picture.)

**What it is:** a free-to-operate task delegation and tracking system for a 12-committee university student council (the CEIT Student Council). Built by the eduCache.on team as a Software Engineering course project, so it is graded partly on matching the written spec in `docs/ARCHITECTURE.md`.

**Who uses it**
- **Admin** (Executive Board): everything — events, invites, user management, global dashboard.
- **Co-Admin** (committee head): their committee's tasks, creating tasks inside events, assigning their members, requesting backup.
- **Member**: sees and updates only tasks assigned to them.

**Core ideas**
- Invite-only (no public sign-up). Users are deactivated, never deleted, so Event Archives stay intact.
- An **Event** contains **Tasks** grouped by phase; each task belongs to one committee, has assignees, a priority, a deadline, optional dependencies, and can be confidential.
- Home = event timeline/Kanban; Workspace = My Tasks + Help Wanted; Executive Dashboard = workload drill-down chart; Archives = frozen past events; Activity Log = immutable audit trail.

**Where we are:** Phases 0–2 done and live; building Phase 3 (the event engine). See `docs/PROGRESS.md` and `docs/PHASE-3-PLAN.md`.

**Audience for any explanation:** the owner is a student still learning — explain the *why* in plain language.
