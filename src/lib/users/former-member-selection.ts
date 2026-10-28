import type { Member } from "@/lib/types";
import { MAX_FORMER_MEMBER_REMOVALS } from "@/lib/users/former-member-removal";

export type SelectionUpdate =
  | { ok: true; selectedIds: Set<string> }
  | { ok: false; selectedIds: Set<string>; message: string };

const LIMIT_MESSAGE = `Select no more than ${MAX_FORMER_MEMBER_REMOVALS} accounts at a time.`;

export function getSelectableFormerMemberIds(members: readonly Member[]) {
  return members
    .filter(
      (member) => member.role !== "Admin" && member.anonymized_at === null,
    )
    .map((member) => member.id);
}

export function updateFormerMemberSelection(
  current: ReadonlySet<string>,
  userId: string,
  selected: boolean,
): SelectionUpdate {
  const next = new Set(current);
  if (!selected) {
    next.delete(userId);
    return { ok: true, selectedIds: next };
  }
  if (next.has(userId)) return { ok: true, selectedIds: next };
  if (next.size >= MAX_FORMER_MEMBER_REMOVALS) {
    return { ok: false, selectedIds: new Set(current), message: LIMIT_MESSAGE };
  }
  next.add(userId);
  return { ok: true, selectedIds: next };
}

export function toggleVisibleFormerMemberSelection(
  current: ReadonlySet<string>,
  visibleIds: readonly string[],
): SelectionUpdate {
  const uniqueVisibleIds = [...new Set(visibleIds)];
  const allSelected =
    uniqueVisibleIds.length > 0 &&
    uniqueVisibleIds.every((userId) => current.has(userId));
  const next = new Set(current);

  if (allSelected) {
    uniqueVisibleIds.forEach((userId) => next.delete(userId));
    return { ok: true, selectedIds: next };
  }

  uniqueVisibleIds.forEach((userId) => next.add(userId));
  if (next.size > MAX_FORMER_MEMBER_REMOVALS) {
    return { ok: false, selectedIds: new Set(current), message: LIMIT_MESSAGE };
  }
  return { ok: true, selectedIds: next };
}
