import { NextResponse } from "next/server";
import { getActiveProfileForRoles, getAuthUser } from "@/lib/auth";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import {
  AVATAR_FILE_NAME,
  avatarObjectPath,
  buildVersionedAvatarUrl,
  findAvatarObject,
} from "../../../lib/avatar";

const ACTIVE_ROLES = ["Admin", "Co-Admin", "Member"] as const;

export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const profile = await getActiveProfileForRoles(ACTIVE_ROLES);
  if (!profile) {
    return NextResponse.json(
      { error: "An active profile is required" },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { action } = body as Record<string, unknown>;
  if (action !== "save" && action !== "remove") {
    return NextResponse.json({ error: "Invalid avatar action" }, { status: 400 });
  }

  const supabase = await createClient();
  const adminClient = await createServiceRoleClient();

  if (action === "remove") {
    // Storage cannot share this transaction. Clear the database reference
    // first, then attempt cleanup, so a failure leaves the profile safe.
    const { error: profileError } = await adminClient
      .from("users")
      .update({ avatar_url: null })
      .eq("id", user.id);

    if (profileError) {
      return NextResponse.json(
        { error: "Failed to remove profile photo" },
        { status: 500 },
      );
    }

    const { error: removeError } = await supabase.storage
      .from("avatars")
      .remove([avatarObjectPath(user.id)]);

    if (removeError) {
      return NextResponse.json({
        success: true,
        avatarUrl: null,
        cleanupPending: true,
        warning:
          "Photo removed from your profile, but the stored file could not be deleted. You can retry cleanup safely.",
      });
    }

    return NextResponse.json({
      success: true,
      avatarUrl: null,
      cleanupPending: false,
    });
  }

  const path = avatarObjectPath(user.id);
  const { data: objects, error: listError } = await supabase.storage
    .from("avatars")
    .list(user.id, { limit: 100, search: AVATAR_FILE_NAME });

  if (listError) {
    return NextResponse.json(
      { error: "Unable to verify the uploaded photo" },
      { status: 502 },
    );
  }

  const object = findAvatarObject(objects);
  if (!object) {
    return NextResponse.json(
      { error: "Uploaded photo was not found" },
      { status: 404 },
    );
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from("avatars").getPublicUrl(path);
  const avatarUrl = buildVersionedAvatarUrl(publicUrl, object);

  const { error: profileError } = await adminClient
    .from("users")
    .update({ avatar_url: avatarUrl })
    .eq("id", user.id);

  if (profileError) {
    return NextResponse.json(
      { error: "Failed to save profile photo" },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, avatarUrl });
}
