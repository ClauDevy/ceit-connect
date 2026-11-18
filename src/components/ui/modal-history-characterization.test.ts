import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");
}

const dialog = source("src/components/ui/dialog.tsx");
const sheet = source("src/components/ui/sheet.tsx");
const alertDialog = source("src/components/ui/alert-dialog.tsx");
const notificationCenter = source("src/components/notifications/notification-center.tsx");
const boardControls = source("src/components/events/event-board-phase-controls.tsx");
const modalHistory = source("src/hooks/use-modal-history.ts");
const taskDetail = source("src/components/tasks/task-detail.tsx");

describe("D1 modal history characterization", () => {
  it("keeps all three shared modal roots centralized", () => {
    expect(dialog).toContain("function Dialog<Payload = unknown>");
    expect(dialog).toContain("useModalHistory<");
    expect(dialog).toContain("<DialogPrimitive.Root");
    expect(sheet).toContain("function Sheet<Payload = unknown>");
    expect(sheet).toContain("useModalHistory<");
    expect(sheet).toContain("<DialogPrimitive.Root");
    expect(alertDialog).toContain("function AlertDialog<Payload = unknown>");
    expect(alertDialog).toContain("useModalHistory<");
    expect(alertDialog).toContain("<AlertDialogPrimitive.Root");
    for (const primitive of [dialog, sheet, alertDialog]) {
      expect(primitive).toContain("actionsRef={actionsRef}");
      expect(primitive).toContain("!details.isCanceled");
    }
  });

  it("requests marker closure before direct-state navigation handoffs", () => {
    const helperStart = modalHistory.indexOf("export async function closeModalAndWait");
    const helperEnd = modalHistory.indexOf("export function useModalHistory", helperStart);
    const helper = modalHistory.slice(helperStart, helperEnd);

    expect(helper.indexOf("requestModalClose(id)")).toBeGreaterThan(-1);
    expect(helper.indexOf("requestModalClose(id)")).toBeLessThan(
      helper.indexOf("close()"),
    );
    expect(modalHistory).not.toContain("{} as TDetails");
  });

  it("consumes late-traversal recovery before touching the modal stack", () => {
    const handlerStart = modalHistory.indexOf("function handlePopState()");
    const handlerEnd = modalHistory.indexOf("function ensureListening()", handlerStart);
    const handler = modalHistory.slice(handlerStart, handlerEnd);

    expect(handler.indexOf("if (recoveringLateTraversal)")).toBeGreaterThan(-1);
    expect(handler.indexOf("if (recoveringLateTraversal)")).toBeLessThan(
      handler.indexOf("stack.pop()"),
    );
  });

  it("awaits task deletion cleanup exactly once before navigation", () => {
    const deleteStart = taskDetail.indexOf("async function deleteTask(");
    const deleteEnd = taskDetail.indexOf("async function unassignSelf", deleteStart);
    const deleteTask = taskDetail.slice(deleteStart, deleteEnd);

    expect(deleteTask.match(/await beforeNavigate\(\);/g)).toHaveLength(1);
    expect(deleteTask.indexOf("await beforeNavigate();")).toBeLessThan(
      deleteTask.indexOf("router.replace(backHref);"),
    );
  });

  it("keeps the app modal roots controlled by open and onOpenChange", () => {
    const modalSources = [
      "src/components/events/banner-cropper.tsx",
      "src/components/events/event-board-dialogs.tsx",
      "src/components/events/event-form-task-dialog.tsx",
      "src/components/events/event-management.tsx",
      "src/components/help/help-manual.tsx",
      "src/components/layout/mobile-nav.tsx",
      "src/components/notifications/notification-center.tsx",
      "src/components/settings/avatar-uploader.tsx",
      "src/components/shared/confirm-dialog.tsx",
      "src/components/tasks/active-task-dialog.tsx",
      "src/components/tasks/completed-phase-reopen-dialog.tsx",
      "src/components/tasks/task-edit-controls.tsx",
      "src/components/tasks/task-people-controls.tsx",
      "src/components/users/edit-member-name-dialog.tsx",
      "src/components/users/former-member-removal-dialog.tsx",
      "src/components/users/invite-officers-dialog.tsx",
      "src/components/users/invite-user-dialog.tsx",
      "src/components/users/officer-transition-dialog.tsx",
    ].map(source);

    for (const modalSource of modalSources) {
      expect(modalSource).toMatch(/<(?:Dialog|Sheet|AlertDialog)[\s\S]*?open=/);
      expect(modalSource).toMatch(/<(?:Dialog|Sheet|AlertDialog)[\s\S]*?onOpenChange=/);
    }
  });

  it("uses a phone Sheet but a desktop Popover for notifications", () => {
    expect(notificationCenter).toContain("export function DesktopNotificationBell()");
    expect(notificationCenter).toContain("<Popover");
    expect(notificationCenter).toContain("export function MobileNotificationBell()");
    expect(notificationCenter).toContain('<Sheet open={openSurface === "mobile"}');
  });

  it("keeps Priority blocking only on phones and Committee non-modal", () => {
    expect(boardControls).toContain('className={cn("fixed inset-0 z-40 bg-black/40 sm:hidden")}');
    expect(boardControls).toContain('role="dialog"');
    expect(boardControls).toContain("sm:absolute");
    expect(boardControls).toContain('role="listbox"');
    expect(boardControls).not.toContain('aria-modal="true"');
  });
});
