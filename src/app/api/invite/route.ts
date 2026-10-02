import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  // Step 1: confirm a real Admin is making this request
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { data: requester } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (requester?.role !== "Admin") {
    return NextResponse.json(
      { error: "Only Admins can invite members" },
      { status: 403 }
    );
  }

  // Step 2: read + validate the new member's details
  const body = await request.json();
  const { email, fullName, role, committeeId } = body as {
    email?: unknown;
    fullName?: string;
    role?: string;
    committeeId?: string | null;
  };

  if (!email || typeof email !== "string" || !fullName || !role) {
    return NextResponse.json(
      { error: "Email, name, and role are required" },
      { status: 400 }
    );
  }

  if (!["Admin", "Co-Admin", "Member"].includes(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  if (role !== "Admin" && !committeeId) {
    return NextResponse.json(
      { error: "Committee is required for Co-Admin and Member roles" },
      { status: 400 }
    );
  }

  // Step 2.5: only allow inviting emails from approved domains. The list
  // comes from an env var so Dev can include test domains (e.g. gmail.com)
  // while Prod stays locked to the real university domain — no code
  // changes needed to switch, just the env var.
  const allowedDomains = (process.env.ALLOWED_EMAIL_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);

  const emailDomain = email.split("@")[1]?.toLowerCase();

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
    await adminClient.auth.admin.inviteUserByEmail(email, {
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
    email,
    full_name: fullName,
    role,
    committee_id: role === "Admin" ? null : committeeId,
  });

  if (profileError) {
    // The auth account was created but the profile insert failed —
    // clean up so we don't leave a broken half-account behind.
    await adminClient.auth.admin.deleteUser(created.user.id);
    return NextResponse.json(
      { error: `Failed to create profile: ${profileError.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}