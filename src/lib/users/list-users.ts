import type { SupabaseClient } from "@supabase/supabase-js";
import { LIST_PAGE_SIZE } from "../list-paging";
import type { Member } from "../types";

export const MAX_USERS_SEARCH_CODE_POINTS = 100;
export const MAX_USERS_OFFSET = 10_000;

export type UsersStatus = "active" | "deactivated";

type ManagedMemberRow = Omit<Member, "anonymized_at">;

type AnonymizationMarkerRow = {
  id: string;
  anonymized_at: string | null;
};

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

function isManagedMemberRow(value: unknown): value is ManagedMemberRow {
  if (!value || typeof value !== "object") return false;
  const member = value as Partial<ManagedMemberRow>;
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

function isNullableTimestamp(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === "string" && !Number.isNaN(Date.parse(value)))
  );
}

export function isMember(value: unknown): value is Member {
  return (
    isManagedMemberRow(value) &&
    isNullableTimestamp((value as Partial<Member>).anonymized_at)
  );
}

function isAnonymizationMarkerRow(
  value: unknown,
): value is AnonymizationMarkerRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<AnonymizationMarkerRow>;
  return typeof row.id === "string" && isNullableTimestamp(row.anonymized_at);
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
  try {
    const { data, error } = await supabase.rpc("list_managed_users", {
      p_is_active: status === "active",
      p_search: search || null,
      p_offset: offset,
    });
    const rows = data ?? [];
    if (error || !Array.isArray(rows) || !rows.every(isManagedMemberRow)) {
      return {
        data: null,
        error: error ?? new Error("Invalid users reader response"),
      };
    }

    if (status === "active") {
      return {
        data: rows.map((row) => ({ ...row, anonymized_at: null })) as Member[],
        error: null,
      };
    }

    if (rows.length === 0) return { data: [] as Member[], error: null };

    const authorizedIds = rows.map((row) => row.id);
    const markerResponse = await supabase
      .from("users")
      .select("id, anonymized_at")
      .in("id", authorizedIds);
    const markerRows = markerResponse.data ?? [];
    if (
      markerResponse.error ||
      !Array.isArray(markerRows) ||
      markerRows.length !== authorizedIds.length ||
      !markerRows.every(isAnonymizationMarkerRow)
    ) {
      return {
        data: null,
        error:
          markerResponse.error ??
          new Error("Invalid users anonymization response"),
      };
    }

    const authorizedIdSet = new Set(authorizedIds);
    const markers = new Map<string, string | null>();
    for (const marker of markerRows) {
      if (!authorizedIdSet.has(marker.id) || markers.has(marker.id)) {
        return {
          data: null,
          error: new Error("Invalid users anonymization response"),
        };
      }
      markers.set(marker.id, marker.anonymized_at);
    }
    if (markers.size !== authorizedIdSet.size) {
      return {
        data: null,
        error: new Error("Invalid users anonymization response"),
      };
    }

    return {
      data: rows.map((row) => ({
        ...row,
        anonymized_at: markers.get(row.id) ?? null,
      })) as Member[],
      error: null,
    };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error : new Error("Users could not be loaded"),
    };
  }
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
