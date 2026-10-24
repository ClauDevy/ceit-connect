# Using Codex and Kiro with CEIT Connect — beginner guide

This file is for **you** (the owner), not for the agents. It explains how the context files work, how to start safely, and gives prompts you can paste.

## 1. How the files work

| File | Who reads it | Purpose |
|---|---|---|
| `AGENTS.md` (repo root) | **Codex and Kiro both read it automatically** | The single source of truth: rules, commands, conventions, and a map of the other files. Keep it short (Codex stops reading project instructions at a default 32 KiB total; this one is about 6 KB). |
| `docs/*.md` | Either tool, **on demand** (AGENTS.md tells them when to open each) | Detail: architecture, database, progress, next steps, gotchas |
| `.kiro/steering/*.md` | Kiro only | Product / tech / structure picture + rules for keeping Kiro's generated specs small |
| `docs/prototypes/*.html` | Either tool | Design source for pages not built yet |

Why plain Markdown and not PDFs: agents read text files reliably; PDFs are for humans. Why one master file: if you change a rule in two places they drift apart — change rules in `AGENTS.md` only.

## 2. One-time setup (about 5 minutes)

1. Copy the zip's contents into the **root of your `ceit-connect` project** (the folder that contains `package.json`). If asked about `AGENTS.md`, choose **Replace** — the zip's version keeps your generated Next.js block intact and adds the project guide below it.
2. Copy the rest of your HTML prototypes (edit-event, archives, etc.) into `docs/prototypes/`.
3. In VSCode Source Control: stage, commit `Add agent context files`, and publish. These files are part of the codebase.
4. Open the `ceit-connect` **root** folder in VSCode (not a subfolder). If you use Kiro CLI, start it from that same folder.

## 3. Check that the tool actually loaded them

Start a **new** thread/session (instructions are read when a session starts, so after editing `AGENTS.md` always start a fresh one) and paste:

> Do not change any files. Read `AGENTS.md` and `docs/PROGRESS.md`, then answer in plain language: (1) What is this project and which phase are we in? (2) Who is allowed to invite users? (3) Why must confidential tasks be read through `get_task`? (4) Which commands are you NOT allowed to run? (5) What is the next step?

A correct answer mentions: Admin-only invites, `get_task` as the security boundary, never running `supabase db push`/`link`, and the current phase and next documented work from `docs/PROGRESS.md`. If it can't, the files weren't found — check you opened the repo root.
In Kiro you should also see steering documents listed as included at the start of a chat.

## 4. Safe settings while you're learning

- Use the mode that **asks your approval** before editing files or running commands (in the Kiro IDE look for *Supervised* mode; in either tool avoid "full access" / "trust all tools" settings — exact names vary by version).
- Never let an agent run Supabase CLI commands against a remote project. You run `db push` yourself.
- **One agent per branch at a time.** Two tools editing the same branch will collide.

## 5. The working loop (point-and-click friendly)

1. New branch: `git checkout -b feature/<short-name>` (Git Bash) or the branch menu in VSCode.
2. Give the agent **one** small task, and ask for a **plan first** (template below). Approve it.
3. Let it edit. In VSCode Source Control, click each changed file to read the diff. If you don't understand a change, ask it to explain.
4. Run the app and do the manual test steps it lists.
5. `npm run build` and `npm run lint` must pass.
6. Run CodeRabbit on the changes (it caught real bugs on every branch so far).
7. **You** commit, Publish Branch, open the PR, merge. **You** push migrations: Dev first → test → merge → Prod.
8. Ask the agent to update `docs/PROGRESS.md` (AGENTS.md already tells it to).

## 6. Prompts you can paste

**Phase 4B build (plan first):**
> Task: `<batch and task>` from `docs/PHASE-4B-PLAN.md`. Read the plan and relevant project docs first, plus `docs/DESIGN-SYSTEM.md` for a UI batch and the batch's step document if one exists. Before planning, ask me up to 5 grouped questions about anything unclear or conflicting with the docs, then wait for my answers. Next, write a short PLAN listing files to create or change, any migration, and unresolved decisions under "Open questions for the owner"; wait for my OK before editing. After approval, implement only the approved scope, run `npm run build` and `npm run lint`, and give me exact manual test steps. Never run a remote Supabase command, commit, push, or open a PR.

**Bug:**
> Bug: I did `<what you did>` and got `<what happened>`. Exact error/terminal output: `<paste>`. Find the root cause first and explain it in plain language before changing anything. Then make the smallest fix and tell me how to verify it.

**Review (no edits):**
> Review my uncommitted changes (`git diff`) against the Golden rules in `AGENTS.md` and `docs/GOTCHAS.md`. List real problems only, most serious first, with file and line. Do not edit files.

**Database change:**
> I need `<change>`. Create it with `npx supabase migration new <name>` and write the SQL including RLS policies. Do NOT run `db push`. Tell me the exact commands I should run and how to test the policy as a specific user.

**Learn:**
> Explain `src/app/api/invite/route.ts` step by step as if I'm new to backend code. Say why each check exists.

## 7. Tool-specific notes

**Codex (VSCode extension)**
- Reads `AGENTS.md` before doing any work: your global `~/.codex/AGENTS.md` first, then the repo root file. Put personal preferences (e.g. "explain in plain language") in the global file if you want them in every project.
- Start a new thread per task so context stays clean. The extension works on the folder you have open — you don't upload files.

**Kiro (IDE or CLI)**
- Picks up the root `AGENTS.md` automatically, plus everything in `.kiro/steering/`. Both are always included, which is why the steering files here are short — every always-on word costs credits on every request.
- **Specs** are Kiro's feature workflow: it writes `requirements.md` → `design.md` → `tasks.md` under `.kiro/specs/<feature>/`, and you approve each stage before the next. You do **not** need to write them by hand; describe one approved planned step and let Kiro generate them. Rules for keeping them small are already in `structure.md`.
- Don't click "Generate Steering Docs" — it would try to create steering files you already have.
- If you create a **custom agent** in the CLI, steering files are not automatically included; add this to the agent's config: `{ "resources": ["file://.kiro/steering/**/*.md"] }`.
- If your Kiro CLI command differs from what a guide shows, `kiro-cli --help` (or the install's help command) lists what's available.

## 8. Which tool for what (a suggestion)

- **Planning, debugging, learning, design decisions, security/RLS review, documents:** a Claude chat — attach these files or the repo zip. This is the step-by-step style you already know works.
- **Building a whole approved feature step across several files:** Kiro's spec flow (you have credits, and the plan → design → tasks stages give you checkpoints).
- **Small fixes, explanations, reviewing a diff:** the Codex extension.
- **Independent review:** keep CodeRabbit.

Do one low-risk practice run first (for example, a small documentation or interface-copy change) on a throwaway branch before trusting an agent with a real feature.

## 9. Stop and ask a human/Claude when…

- An agent wants to change RLS policies, `get_task`, auth routes, or anything with the service-role key — review the diff line by line first.
- It suggests running `db push`, `link`, `db reset`, or touching Prod.
- It "fixes" something by deleting a check or ignoring an error.
- The same fix has failed twice.

## 10. Keeping the files healthy

- Change **rules** only in `AGENTS.md`; change **status** only in `docs/PROGRESS.md`; add new lessons to `docs/GOTCHAS.md`.
- When the architecture changes, update `docs/ARCHITECTURE.md` (and the "Approved deviations" list) — the course grades against the written spec.
- If an agent ignores a rule, check: right folder open? new session started after the edit? `AGENTS.md` still small?
