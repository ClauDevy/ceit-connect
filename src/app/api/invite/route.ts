import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getActiveProfileForRoles, getAuthUser } from "@/lib/auth";
import { parseAllowedEmailDomains } from "../../../lib/allowed-email-domains";

export async function POST(request: Request) {
  // Route handlers must return JSON for signed-out callers. Calling
  // requireUser() here would throw Next.js's 307 redirect response instead.
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const requester = await getActiveProfileForRoles(["Admin"]);
  if (!requester) {
    return NextResponse.json(
      { error: "Only active Admins can invite members" },
      { status: 403 }
    );
  }

  // Step 2: read + validate the new member's details
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { email, fullName, role, committeeId } = body as Record<
    string,
    unknown
  >;

  if (
    typeof email !== "string" ||
    typeof fullName !== "string" ||
    typeof role !== "string" ||
    (committeeId !== undefined &&
      committeeId !== null &&
      typeof committeeId !== "string")
  ) {
    return NextResponse.json(
      { error: "Email, name, and role are required" },
      { status: 400 }
    );
  }

  const normalizedEmail = email.trim().toLowerCase();
  const normalizedFullName = fullName.trim();
  const normalizedCommitteeId =
    typeof committeeId === "string" ? committeeId.trim() : committeeId;

  if (!normalizedEmail || !normalizedFullName || !role) {
    return NextResponse.json(
      { error: "Email, name, and role are required" },
      { status: 400 }
    );
  }

  if (!["Admin", "Co-Admin", "Member"].includes(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  if (role !== "Admin" && !normalizedCommitteeId) {
    return NextResponse.json(
      { error: "Committee is required for Co-Admin and Member roles" },
      { status: 400 }
    );
  }

  // Step 2.5: only allow inviting emails from approved domains. The list
  // comes from an env var so Dev can include test domains (e.g. gmail.com)
  // while Prod stays locked to the real university domain — no code
  // changes needed to switch, just the env var.
  const allowedDomains = parseAllowedEmailDomains(
    process.env.ALLOWED_EMAIL_DOMAINS,
  );

  const emailDomain = normalizedEmail.split("@")[1]?.toLowerCase();

  if (allowedDomains.length > 0 && !allowedDomains.includes(emailDomain)) {
    return NextResponse.json(
      {
        error: `Only these email domains can be invited: ${allowedDomains.join(", ")}`,
      },
      { status: 400 }
    );
  }

  // Step 3: create the real auth account + send the invite email
  const adminClient = await createServiceRoleClient();
  const origin = new URL(request.url).origin;

  const { data: created, error: inviteError } =
    await adminClient.auth.admin.inviteUserByEmail(normalizedEmail, {
      redirectTo: `${origin}/auth/callback`,
    });

  if (inviteError || !created.user) {
    return NextResponse.json(
      { error: inviteError?.message ?? "Failed to send invite" },
      { status: 500 }
    );
  }

  // Step 4: create their profile row to match
  const { error: profileError } = await adminClient.from("users").insert({
    id: created.user.id,
    email: normalizedEmail,
    full_name: normalizedFullName,
    role,
    committee_id: role === "Admin" ? null : normalizedCommitteeId,
  });

  if (profileError) {
    // The auth account was created but the profile insert failed —
    // clean up so we don't leave a broken half-account behind.
    const { error: rollbackError } =
      await adminClient.auth.admin.deleteUser(created.user.id);
    if (rollbackError) {
      return NextResponse.json(
        { error: "Failed to create profile and roll back the invitation" },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { error: `Failed to create profile: ${profileError.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
