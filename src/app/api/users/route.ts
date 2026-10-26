import { NextResponse } from "next/server";
import { getActiveProfileForRoles, getAuthUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  listUsersPage,
  normalizeUsersSearch,
  parseUsersOffset,
  parseUsersStatus,
} from "@/lib/users/list-users";
import type { Committee } from "@/lib/types";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function isCommittee(value: unknown): value is Committee {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as Committee).id === "string" &&
    typeof (value as Committee).name === "string"
  );
}

export async function GET(request: Request) {
  const user = await getAuthUser();
  if (!user) return json({ error: "Not signed in" }, 401);

  const requester = await getActiveProfileForRoles(["Admin"]);
  if (!requester) {
    return json({ error: "Only active Admins can view users" }, 403);
  }

  const searchParams = new URL(request.url).searchParams;
  const status = parseUsersStatus(searchParams.get("status"));
  const offset = parseUsersOffset(searchParams.get("offset"));
  const normalizedSearch = normalizeUsersSearch(searchParams.get("search") ?? "");

  if (!status || offset === null || !normalizedSearch.ok) {
    return json({ error: "Invalid users query" }, 400);
  }

  const supabase = await createClient();
  let committees: Committee[] = [];

  if (normalizedSearch.value) {
    const { data, error } = await supabase
      .from("committees")
      .select("id, name")
      .order("name");
    if (error || !Array.isArray(data) || !data.every(isCommittee)) {
      return json({ error: "Users could not be loaded" }, 500);
    }
    committees = data;
  }

  try {
    const { data, error } = await listUsersPage(supabase, {
      committees,
      offset,
      search: normalizedSearch.value,
      status,
    });
    if (error) return json({ error: "Users could not be loaded" }, 500);
    return json({ users: data });
  } catch {
    return json({ error: "Users could not be loaded" }, 500);
  }
}
