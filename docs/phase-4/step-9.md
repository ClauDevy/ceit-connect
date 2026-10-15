# Step 9 — Task comments without Phase 5 notifications

**Status:** Optional.

- Add `task_comments`: `id`, `task_id`, server-derived `created_by`, `body`, `is_heads_up`, optional validated `mentioned_user_ids`, `created_at`, and nullable `edited_at`. Render the task modal's Collaboration & Activity thread and mention picker using only valid targets.
- Anyone who currently sees the real task content may comment; a masked viewer never may. An author may edit their own comment, which re-validates body and mentions, sets `edited_at`, and renders “(edited).” An author may delete their own comment; an active Admin may delete any comment. Co-Admins receive no blanket delete right unless they authored the comment.
- Archived comments remain readable to current real-content viewers, including optional archive-only viewers after Step 7B, but every insert/update/delete is blocked by an independent parent-status guard. Heads Up and mentions are stored for future notification generation; Phase 4 creates no notifications and changes no unread counts.
- **Database impact:** adds `task_comments`, indexes/foreign keys, RLS or narrow write functions, and an Archived-parent write guard. New migration: **yes**. `notifications` remains untouched.
- **Guards that must remain true:** comment reads always use the current real-content decision; masked users receive no comment rows; Archived comments are immutable; comments cannot mutate tasks/events or affect the Active-event task invariant.
- **Security risks:** never trust author, task, mention, or cached-access ids. Derive the author, re-check current task access on every read/write, cap body and mention count, validate mentions again on edit, render plain text safely, check exact affected-row counts, and prevent comment/mention lookups from leaking confidential task existence.
- **Test deliverable:** `docs/PHASE-4-STEP-9-TESTS.md` follows the global test contract and covers every real-content and masked role, author edit/delete, Admin deletion, Co-Admin limits, `edited_at`, mention revalidation, immediate access-list revocation, optional late-share reads, Archived immutability, and absence of notification writes.
- **Acceptance:** every current real-content viewer can comment; masked and inactive users cannot; authors edit/delete their own comments; Admin deletes any; edited comments show “(edited)”; access changes apply immediately; Archived comments are readable but immutable; no notification row is created.

[Back to Phase 4 index](../PHASE-4-PLAN.md)
