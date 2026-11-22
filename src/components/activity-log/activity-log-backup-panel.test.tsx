// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), replace: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));

import { ActivityLogBackupPanel } from "./activity-log-backup-panel";
import { ActivityLogPageClient } from "./activity-log-page";

type BackupFixture = {
  backup_id: string;
  backup_kind: "monthly_retention" | "manual_before_date" | "manual_all";
  backup_status: string;
  fixed_cutoff_at: string;
  file_count: number;
  row_count: number;
  deleted_count: number;
  delete_expires_at: string | null;
  created_at: string;
  completed_at: string | null;
  attempt_count: number;
  next_attempt_at: string;
  email_attempt_count: number;
  last_error_code: string | null;
};

const now = Date.now();
function backup(overrides: Partial<BackupFixture> = {}): BackupFixture {
  return {
    backup_id: "backup-a",
    backup_kind: "manual_before_date",
    backup_status: "completed",
    fixed_cutoff_at: new Date(now - 3_600_000).toISOString(),
    file_count: 1,
    row_count: 12,
    deleted_count: 12,
    delete_expires_at: null,
    created_at: new Date(now - 1_800_000).toISOString(),
    completed_at: new Date(now - 1_200_000).toISOString(),
    attempt_count: 0,
    next_attempt_at: new Date(now).toISOString(),
    email_attempt_count: 0,
    last_error_code: null,
    ...overrides,
  };
}

const downloadedFile = {
  file_id: "file-a",
  part_number: 1,
  object_path: "backup-a/activity-log-part-1.csv",
  row_count: 12,
  raw_byte_count: 120,
  sha256_hex: "a".repeat(64),
  downloaded_by_caller: true,
};

function renderPanel(backups: BackupFixture[], files: Record<string, typeof downloadedFile[]> = {}) {
  mocks.rpc.mockImplementation(async (name: string, args?: { p_backup_id?: string }) => {
    if (name === "list_activity_log_backups") return { data: backups, error: null };
    if (name === "list_activity_log_backup_files") {
      return { data: files[args?.p_backup_id ?? ""] ?? [], error: null };
    }
    return { data: true, error: null };
  });
  return render(<ActivityLogBackupPanel />);
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("Activity Log backup panel", () => {
  it("is collapsed by default", async () => {
    renderPanel([backup()]);
    await screen.findByText(/Last backup:/);
    const toggle = screen.getByRole("button", { name: "Show backups and clearing" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Prepare backup for this date" })).toBeNull();
  });

  it("pins the current backup once and excludes it from the history count", async () => {
    const active = backup({ backup_id: "active", backup_status: "deletion_requested", created_at: new Date(now).toISOString() });
    const complete = backup({ backup_id: "complete" });
    renderPanel([active, complete]);
    await screen.findByText(/Current backup:/);
    expect(screen.getByText("Backup in progress")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show backups and clearing" }));
    expect(screen.getByRole("heading", { name: "Current backup" })).toBeTruthy();
    expect(screen.getAllByText("Deleting").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Backup history (1)" })).toBeTruthy();
  });

  it("moves an expired ready backup to history with Expired wording", async () => {
    renderPanel([backup({ backup_status: "ready", delete_expires_at: new Date(now - 1_000).toISOString() })]);
    await screen.findByText(/Last backup:.*Expired/);
    fireEvent.click(screen.getByRole("button", { name: "Show backups and clearing" }));
    expect(screen.queryByRole("heading", { name: "Current backup" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Backup history (1)" }));
    expect(screen.getAllByText("Expired").length).toBeGreaterThan(0);
    expect(screen.queryByText("Needs attention")).toBeNull();
    expect(screen.queryByRole("button", { name: /Continue to delete/i })).toBeNull();
  });

  it("renders a completed zero-row backup as a muted non-deletion result", async () => {
    renderPanel([backup({ row_count: 0, file_count: 0, deleted_count: 0 })]);
    await waitFor(() => expect(screen.getAllByText(/Nothing to delete/).length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: "Show backups and clearing" }));
    fireEvent.click(screen.getByRole("button", { name: "Backup history (1)" }));
    const row = screen.getByRole("button", { name: /Expand Before-date backup/ });
    expect(row.parentElement?.className).toContain("bg-muted/30");
    expect(screen.queryByRole("button", { name: /Continue to delete/i })).toBeNull();
  });

  it("expands history rows and keeps email retry plus the raw support code reachable", async () => {
    const failed = backup({ backup_status: "email_failed", last_error_code: "email_delivery_failed" });
    renderPanel([failed], { "backup-a": [downloadedFile] });
    expect(await screen.findByText("Email not sent")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show backups and clearing" }));
    const historyToggle = screen.getByRole("button", { name: "Backup history (1)" });
    expect(historyToggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(historyToggle);
    const rowToggle = screen.getByRole("button", { name: /Expand Before-date backup/ });
    expect(rowToggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(rowToggle);
    expect(rowToggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("The backup email could not be sent. Use Retry email to try again.")).toBeTruthy();
    expect(screen.getByText("Error code: email_delivery_failed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry email" })).toBeTruthy();
  });

  it("drives the visible date prompt from the controlled value", async () => {
    renderPanel([]);
    await screen.findByText("No backups yet.");
    fireEvent.click(screen.getByRole("button", { name: "Show backups and clearing" }));
    expect(screen.getByText("Select a date")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-11-20" } });
    expect(screen.queryByText("Select a date")).toBeNull();
    expect(screen.getByRole("button", { name: "Prepare backup for this date" }).hasAttribute("disabled")).toBe(false);
  });

  it("keeps the email warning visible when an older backup needs retry", async () => {
    const latest = backup({ backup_id: "latest", backup_status: "completed", created_at: new Date(now).toISOString() });
    const olderFailure = backup({
      backup_id: "older-failure",
      backup_status: "email_failed",
      created_at: new Date(now - 3_600_000).toISOString(),
      last_error_code: "email_delivery_failed",
    });
    renderPanel([latest, olderFailure]);
    await screen.findByText(/Last backup:.*Complete/);
    expect(screen.getByText("Email not sent")).toBeTruthy();
  });

  it("renders no Admin backup UI and makes no backup RPC for a Co-Admin capability", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}>
      <ActivityLogPageClient
        initialWindow={{ rows: [], hasMore: false, cursor: null, pageCount: 0, unavailable: false }}
        initialLoadFailed={false}
        committees={[]}
        canManageActivityLog={false}
        initialRetentionSetting={null}
      />
    </QueryClientProvider>);
    await waitFor(() => expect(screen.queryByText("Backups and clearing")).toBeNull());
    expect(mocks.rpc).not.toHaveBeenCalledWith("list_activity_log_backups", expect.anything());
  });
});
