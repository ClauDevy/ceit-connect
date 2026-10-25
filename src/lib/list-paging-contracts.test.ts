import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = join(process.cwd(), "supabase", "migrations");
const migrationFiles = readdirSync(migrationsDirectory).filter((name) =>
  name.endsWith(".sql"),
);
const allMigrations = migrationFiles
  .map((name) => readFileSync(join(migrationsDirectory, name), "utf8"))
  .join("\n")
  .toLowerCase();

function definitionCount(functionName: string) {
  return (
    allMigrations.match(
      new RegExp(
        `create(?: or replace)? function public\\.${functionName}\\s*\\(`,
        "g",
      ),
    ) ?? []
  ).length;
}

describe("tracked paging reader contracts", () => {
  it("keeps all four linear lists on the shared offset paging strategy", () => {
    const listSources = [
      join("src", "components", "events", "home-event-list.tsx"),
      join("src", "components", "archives", "archive-event-list.tsx"),
      join("src", "components", "tasks", "my-tasks-list.tsx"),
      join("src", "components", "tasks", "help-wanted-list.tsx"),
    ];
    for (const relativePath of listSources) {
      const source = readFileSync(join(process.cwd(), relativePath), "utf8");
      expect(source).toContain("useOffsetListPaging");
    }
  });

  it("keeps one list_my_tasks definition with a 100-row cap and task-id tie-breaker", () => {
    const sql = readFileSync(
      join(migrationsDirectory, "20261022150000_list_my_tasks.sql"),
      "utf8",
    ).toLowerCase();
    expect(definitionCount("list_my_tasks")).toBe(1);
    expect(sql).toContain("p_limit > 100");
    expect(sql).toMatch(/assigned\.task_id asc\s+limit p_limit/);
  });

  it("keeps one list_help_wanted_tasks definition with a 100-row cap and task-id tie-breaker", () => {
    const sql = readFileSync(
      join(
        migrationsDirectory,
        "20261022120000_task_claim_backup_volunteers.sql",
      ),
      "utf8",
    ).toLowerCase();
    expect(definitionCount("list_help_wanted_tasks")).toBe(1);
    expect(sql).toContain("p_limit > 100");
    expect(sql).toMatch(
      /order by task_row\.due_date nulls last, task_row\.id\s+limit p_limit/,
    );
  });

  it("adds no Batch 3P migration", () => {
    expect(
      migrationFiles.some((name) => name.toLowerCase().includes("list_paging")),
    ).toBe(false);
  });
});
