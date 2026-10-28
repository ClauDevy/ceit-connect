import type { Member } from "@/lib/types";

export function getVisibleMembers(
  members: readonly Member[],
  showRemovedMembers: boolean,
) {
  return showRemovedMembers
    ? [...members]
    : members.filter((member) => member.anonymized_at === null);
}

export function countRemovedMembers(members: readonly Member[]) {
  return members.filter((member) => member.anonymized_at !== null).length;
}

export function isUsersSearchDebouncing(query: string, settledSearch: string) {
  return query.trim() !== settledSearch;
}
