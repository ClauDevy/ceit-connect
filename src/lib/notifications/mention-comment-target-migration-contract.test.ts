import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read(
  "supabase/migrations/20261118120000_mention_notification_comment_targets.sql",
).toLowerCase();
const devTests = read("docs/phase-5/step-j1-mention-comment-targets-dev-tests.sql");
const phaseFivePlan = read("docs/phase-5/PHASE-5-PLAN.md");

describe("mention comment target migration contract", () => {
  it("adds a nullable, mention-only comment reference with deletion fallback", () => {
    expect(migration).toContain("add column comment_id uuid;");
    expect(migration).toContain("references public.task_comments(id)\non delete set null");
    expect(migration).toContain("check (comment_id is null or type = 'mention')");
    expect(migration).not.toMatch(/comment_id uuid not null/);
  });

  it("preflights exactly five latest functions, no overloads, and no drop dependencies", () => {
    expect(migration).toContain("if v_replaced_count <> 5");
    expect(migration).toContain("v_dependent_count <> 0");
    expect(migration).toContain("a drop-and-recreate function has dependent objects");
    expect(migration.match(/drop function /g)).toHaveLength(3);
  });

  it("stores the exact comment only for mention notifications", () => {
    expect(migration).toContain("p_comment_id uuid default null");
    expect(migration).toContain("'mention', new.task_id, new.created_by, v_mention_ids, new.id");
    expect(migration).toContain("comment_row.id = p_comment_id");
    expect(migration).toContain("comment_row.task_id = p_task_id");
  });

  it("keeps the reader access-aware and exposes the changed public return shape", () => {
    expect(migration).toContain("public.task_content_access_for_user(");
    expect(migration.match(/out_comment_id uuid/g)).toHaveLength(2);
    expect(migration).toContain("notification_row.content_access = 'real'");
    expect(migration).toContain("when notification_row.content_access = 'hidden' then null::uuid");
  });

  it("authorizes push before mutation and emits only fixed local task targets", () => {
    const authentication = migration.indexOf("authenticate_push_sender()");
    const firstMutation = Math.min(
      migration.indexOf("delete from ceit_connect_private.push_delivery_queue"),
      migration.indexOf("update ceit_connect_private.push_delivery_queue"),
    );
    expect(authentication).toBeGreaterThan(-1);
    expect(authentication).toBeLessThan(firstMutation);
    expect(migration).toContain("'/tasks/%s#comment-%s'");
    expect(migration).toContain("pg_catalog.format('/tasks/%s', notification.task_id)");
    expect(migration).not.toContain("'/notifications'");
  });

  it("uses the exact comment-list ordering and one fixed denial", () => {
    const anchor = migration.slice(
      migration.indexOf("create function public.get_task_comment_target_page_anchor"),
      migration.indexOf("alter function public.get_task_comment_target_page_anchor"),
    );
    expect(anchor.match(/order by comment_row\.created_at desc, comment_row\.id desc/g)).toHaveLength(2);
    expect(anchor.match(/message = 'the target comment is unavailable\.'/g)).toHaveLength(3);
    expect(anchor).toContain("public.task_content_access_for_user(p_task_id, v_caller_id) <> 'real'");
  });

  it("restores owners, revokes, and only the intended public grants", () => {
    expect(migration.match(/owner to postgres;/g)).toHaveLength(6);
    expect(migration).toContain("grant execute on function public.list_notifications(integer, timestamptz, uuid)\nto authenticated;");
    expect(migration).toContain("grant execute on function public.get_task_comment_target_page_anchor(uuid, uuid, integer)\nto authenticated;");
    expect(migration).toContain("grant execute on function public.claim_push_deliveries(integer) to anon;");
  });
});

describe("mention target app contract", () => {
  const comments = read("src/components/tasks/task-comments.tsx");
  const center = read("src/components/notifications/notification-center.tsx");
  const styles = read("src/app/globals.css");
  const worker = read("public/sw.js");

  it("loads one bounded target page and exposes Back to newest", () => {
    expect(comments).toContain('rpc("get_task_comment_target_page_anchor"');
    expect(comments).toContain("p_limit: TASK_COMMENT_PAGE_SIZE");
    expect(comments).toContain("Back to newest");
    expect(comments).toContain("scrollIntoView");
    expect(comments).toContain("motion-comment-target-highlight");
    expect(comments).toContain("TASK_COMMENT_TARGET_PAGE_ATTEMPTS = 2");
    expect(comments).toContain("attempt < TASK_COMMENT_TARGET_PAGE_ATTEMPTS");
    expect(comments).toContain("current?.olderPagingStarted");
    expect(comments).toContain("replaceTaskCommentNewestPage(");
    expect(comments).toContain("setTargetActivation((current) => current + 1)");
    expect(comments).toContain('{ queryKey: ["task-comments", taskId] }');
    expect(comments).toContain("isTaskCommentUnavailableError(targetQuery.error)");
    expect(comments).toContain("await Promise.all([newestQuery.refetch(), onRefreshTask()])");
    expect(comments).toContain("deletingSelectedTarget");
    expect(comments).toContain("refetchInterval: mutationAction === null ? POLL_INTERVAL_MS : false");
    expect(center).toContain('window.dispatchEvent(new Event("hashchange"))');
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.motion-comment-target-highlight \{[\s\S]*background: color-mix/,
    );
  });

  it("keeps service-worker navigation to an exact allowlist", () => {
    expect(worker).toContain("TARGET_PATTERN");
    expect(worker).toContain("validatedTargetPath");
    expect(worker).toContain("existing.navigate(targetPath)");
  });
});

describe("mention target Dev paste contract", () => {
  it("uses one privileged fixture window and returns to postgres for direct tie inspection", () => {
    expect(devTests.match(/set local session_replication_role = replica;/g)).toHaveLength(1);
    expect(devTests.indexOf("set local session_replication_role = replica;")).toBeLessThan(
      devTests.indexOf("insert into public.tasks("),
    );
    expect(devTests.indexOf("reset role;\nselect pg_temp.j1_record('10 timestamp tie")).toBeGreaterThan(-1);
    expect(devTests).toContain(
      "and not exists(select 1 from public.task_comments where id='81000000-0000-4000-8000-000000000052')",
    );
  });
});

describe("Phase 5 completion gate", () => {
  it("requires J1 review and rollout before Phase 5 can complete", () => {
    const gate = phaseFivePlan.slice(
      phaseFivePlan.indexOf("## Phase 5 gate checks"),
      phaseFivePlan.indexOf("## Deferred", phaseFivePlan.indexOf("## Phase 5 gate checks")),
    );
    expect(gate).toMatch(/R1, R2, and J1[^.]*completed review and\s+rollout\./);
  });
});
