# Phase 5 H1 — in-app user manual

## Status and scope

H1 is planned after U1 and V1 and before the manifest-screenshots batch. It is
UI-only, uses Medium reasoning, and adds no database object or migration. The
manual describes the app only after U1 and V1 are merged and the live L1 and G1
rules are reflected accurately.

The content is a sample template the owner can edit later. Implementation must
verify every factual statement against current application code, migrations,
tests, and project documentation. Anything not proven moves to **To confirm
with the owner** instead of being guessed.

## Approved experience

- Add `/help` inside the logged-in app shell.
- Put a **Help & user manual** card at the top of Settings.
- Add a small **Help** link to the desktop sidebar and mobile menu.
- Design mobile first: a short Quick start card, collapsible content sections,
  and a jump-to menu. Desktop uses a sticky table of contents.
- Add an FAQ accordion with a search box that filters questions.
- Show **Co-Admin and Admin only** only to those roles. Members never receive
  that section in rendered content. State every Admin/Co-Admin difference,
  including the Co-Admin's own-committee boundary.
- Store static typed content in the application. There is no database,
  migration, CMS, or image asset in H1.
- Leave clearly labelled empty screenshot slots for the later screenshots
  batch.
- Use short plain English, existing semantic design tokens, shared components,
  the shared motion kit, and the complete reduced-motion behavior.

## Accuracy gate

Before writing final copy, verify at least these rules against their real
implementation and current docs:

- the ordinary 72-hour leave rule and the L1 Live Operation call-time version;
- effective-priority labels, including that the displayed effective priority
  can rise without changing the stored priority;
- 30-day Activity Log retention;
- who may claim, volunteer, assign, or manage backup requests;
- confidential-task row and content visibility, including viewer lists;
- what task assignments do when a member is deactivated or anonymized;
- iPhone versus Android install, permission, and push requirements;
- all bell notification types, reminder windows, and G1 grouped-push delay and
  wording;
- U1's initial incomplete phase, President-picker exclusions, and cleared
  imported deadlines;
- V1's Manila-date Active-task deadline rule, grandfathering, and Admin-only
  President committee invariant; and
- every role and committee boundary described in leadership instructions.

The audit must use the post-U1/V1 code, not this planning document as evidence.
Record unclear or conflicting behavior under **To confirm with the owner**.

## Starting content outline

### 1. Getting started

- Accepting an invite and signing in.
- Setting and resetting a password.
- Updating name and photo.
- Theme controls.
- Adding the site to an iPhone or Android home screen.
- Turning on notifications, including platform differences.

### 2. Your tasks

- Reading event boards, phases, lanes, completion, and the U1 initial phase.
- Opening a task and understanding its visible fields.
- Deliverable versus Live Operation, including call and end times.
- Stored priority versus effective priority labels for due-soon, overdue, and
  running work.
- Workspace: My Tasks and Help Wanted.
- Claiming a Backlog task; backup requests and volunteering.
- Work links, Drive preview, comments, and comment editing rules.
- Unassigning yourself, the 72-hour boundary, Live Operation timing, and the
  leave-request path.

### 3. Events

- Home and event access.
- Banners, event boards, and the Archives view.
- A short explanation of Draft, Active, and Archived states where relevant to
  the viewer.

### 4. Notifications

- Bell rows, unread state, deletion, and Clear read.
- Push setup and troubleshooting on iPhone and Android.
- Plain-language meanings for every current notification type.
- G1 grouped alerts such as “You were assigned to 3 tasks,” including the
  short grouping delay.
- Due reminders within 24 hours and Live Operation call reminders within two
  hours.

### 5. Co-Admin and Admin only

- Assigning people, setting task dependencies, and committee boundaries.
- Confidential tasks and additional viewer lists.
- Creating, editing, archiving, and deleting tasks where permitted.
- Launching an event and using archived templates, including U1's blank
  imported deadlines and the verified Live Operation launch requirements.
- Handling leave requests, volunteer offers, and backup requests.
- Reading the Executive Dashboard: overdue, due soon, at risk, and running.
- Reading the Activity Log and its 30-day retention.
- Inviting, deactivating, reactivating, and removing members and officers.
- President committee and other Admin-versus-Co-Admin rules, including V1.

### 6. FAQ and troubleshooting

The searchable FAQ starts with:

- I can't log in. What do I do?
- I forgot my password.
- Why can't I see a task my friend sees?
- Who can claim a task, and who can assign one?
- Can I edit or delete my comment?
- How do I turn on notifications on my phone?
- Why did I stop getting notifications?
- Why did my task show a higher priority than I set?
- Why can't I leave a task right away?
- Why did I get one notification for several tasks?
- How long does the Activity Log keep entries?
- What happens to my tasks if I'm removed from the organization?
- Why is my name or photo not updating?
- Who do I contact if something is broken?

The contact answer remains placeholder wording until the owner supplies and
approves the real contact route. Never invent a name, account, email, or phone
number. Include the name/photo question only if its cause and recovery steps
can be verified; otherwise move it to **To confirm with the owner**.

## Proposed outline changes for owner approval

The owner's outline is the starting point. H1 proposes these changes after the
accuracy audit:

- Add a compact **Where things are** navigation map covering Home, Workspace,
  Dashboard, Events, Archives, Activity Log, Users, Settings, and Help.
- Add a role/committee callout at the start so readers understand why screens
  and actions differ before encountering detailed instructions.
- Add task phases, completion locks, and reopening to **Your tasks**, because
  they materially affect what controls appear.
- Merge backup requests and volunteering into one **Getting help on a task**
  subsection to avoid explaining the same flow twice.
- Keep Events intentionally short and link leadership event creation, launch,
  templates, and lifecycle actions to the restricted section.
- Keep install/push setup brief in **Getting started** and place detailed
  platform troubleshooting only in the FAQ to avoid duplication.
- Add notification deletion and Clear read because they are current user-facing
  behavior missing from the starting outline.
- Add deactivation versus anonymized removal to the leadership section and FAQ,
  using only verified effects on assignments, sign-in, and historical records.
- Do not add a separate Dashboard section for Members because the Executive
  Dashboard is leadership-only; cover it inside the restricted section.
- Keep screenshot placeholders beside the steps they will illustrate instead
  of creating an empty screenshot-only chapter.

The owner approves, rejects, or edits these outline changes before H1 content
is treated as final.

## To confirm with the owner

- The real “Who do I contact?” destination and exact placeholder replacement.
- Any name/photo refresh cause that cannot be demonstrated from current code.
- Any platform-specific install or push wording not reproducible on the
  owner's supported iPhone and Android versions.
- Any behavior where post-U1/V1 code, migrations, and current docs disagree.
