import type { SupabaseClient } from "@supabase/supabase-js";
import { LIST_PAGE_SIZE } from "../list-paging";
import type { Member } from "../types";

export const MAX_USERS_SEARCH_CODE_POINTS = 100;
export const MAX_USERS_OFFSET = 10_000;

export type UsersStatus = "active" | "deactivated";

export function normalizeUsersSearch(raw: string) {
  const value = raw.trim();
  if ([...value].length > MAX_USERS_SEARCH_CODE_POINTS) {
    return {
      ok: false as const,
      message: `Search must be ${MAX_USERS_SEARCH_CODE_POINTS} characters or fewer.`,
    };
  }
  return { ok: true as const, value };
}

export function truncateUsersSearch(raw: string) {
  return [...raw].slice(0, MAX_USERS_SEARCH_CODE_POINTS).join("");
}

export function isMember(value: unknown): value is Member {
  if (!value || typeof value !== "object") return false;
  const member = value as Partial<Member>;
  return (
    typeof member.id === "string" &&
    typeof member.full_name === "string" &&
    typeof member.email === "string" &&
    typeof member.role === "string" &&
    (member.committee_id === null || typeof member.committee_id === "string") &&
    (member.avatar_url === null || typeof member.avatar_url === "string") &&
    typeof member.is_active === "boolean"
  );
}

export async function listUsersPage(
  supabase: SupabaseClient,
  {
    offset,
    search,
    status,
  }: {
    offset: number;
    search: string;
    status: UsersStatus;
  },
) {
  const { data, error } = await supabase.rpc("list_managed_users", {
    p_is_active: status === "active",
    p_search: search || null,
    p_offset: offset,
  });
  const rows = data ?? [];
  return {
    data: Array.isArray(rows) && rows.every(isMember) ? (rows as Member[]) : null,
    error:
      Array.isArray(rows) && rows.every(isMember)
        ? error
        : (error ?? new Error("Invalid users reader response")),
  };
}

export function parseUsersOffset(raw: string | null) {
  if (raw === null || !/^(0|[1-9]\d*)$/.test(raw)) return null;
  const value = Number(raw);
  if (
    !Number.isSafeInteger(value) ||
    value > MAX_USERS_OFFSET ||
    value % LIST_PAGE_SIZE !== 0
  ) {
    return null;
  }
  return value;
}

export function parseUsersStatus(raw: string | null): UsersStatus | null {
  return raw === "active" || raw === "deactivated" ? raw : null;
}
