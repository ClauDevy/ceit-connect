import type { SupabaseClient } from "@supabase/supabase-js";
import { LIST_FETCH_LIMIT, LIST_PAGE_SIZE } from "../list-paging";
import type { Committee, Member } from "../types";

export const MAX_USERS_SEARCH_CODE_POINTS = 100;
export const MAX_USERS_OFFSET = 10_000;

export type UsersStatus = "active" | "deactivated";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isStrictUuid(value: string) {
  return UUID_PATTERN.test(value);
}

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

function escapeIlikeLiteral(value: string) {
  // Layer 1 is PostgreSQL ILIKE escaping. Backslash is the LIKE escape
  // character, so a literal backslash, %, or _ must reach PostgreSQL as
  // \\, \%, or \_ respectively. The surrounding % wildcards are added later.
  return value
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}

function quotePostgrestValue(value: string) {
  // Layer 2 is PostgREST grammar escaping. Quoting prevents commas, dots,
  // colons, and parentheses from becoming .or() syntax. Within those quotes,
  // both backslashes (including Layer 1's) and double quotes are escaped.
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function matchingCommitteeIds(
  committees: readonly Committee[],
  search: string,
) {
  const needle = search.toLocaleLowerCase();
  return committees
    .filter((committee) => committee.name.toLocaleLowerCase().includes(needle))
    .map((committee) => committee.id);
}

export function buildUsersSearchFilter(
  search: string,
  committeeIds: readonly string[],
) {
  if (!search) return null;

  for (const id of committeeIds) {
    if (!isStrictUuid(id)) {
      throw new Error("Invalid committee id returned by the lookup.");
    }
  }

  const ilikePattern = quotePostgrestValue(
    `%${escapeIlikeLiteral(search)}%`,
  );
  const filters = [
    `full_name.ilike.${ilikePattern}`,
    `email.ilike.${ilikePattern}`,
    `role.ilike.${ilikePattern}`,
  ];

  if (committeeIds.length > 0) {
    filters.push(`committee_id.in.(${committeeIds.join(",")})`);
  }

  return filters.join(",");
}

export async function listUsersPage(
  supabase: SupabaseClient,
  {
    committees,
    offset,
    search,
    status,
  }: {
    committees: readonly Committee[];
    offset: number;
    search: string;
    status: UsersStatus;
  },
) {
  const committeeIds = search
    ? matchingCommitteeIds(committees, search)
    : [];
  const searchFilter = buildUsersSearchFilter(search, committeeIds);

  let query = supabase
    .from("users")
    .select("id, full_name, email, role, committee_id, avatar_url, is_active")
    .eq("is_active", status === "active");

  if (searchFilter) query = query.or(searchFilter);

  const { data, error } = await query
    .order("full_name", { ascending: true })
    .order("id", { ascending: true })
    .range(offset, offset + LIST_FETCH_LIMIT - 1);
  return { data: (data ?? []) as Member[], error };
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
