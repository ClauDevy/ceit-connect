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
    email?: string;
    fullName?: string;
    role?: string;
    committeeId?: string | null;
  };

  if (!email || !fullName || !role) {
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
    // auth account was created but the profile insert failed —
    // clean up instead of leaving a broken half-account behind
    await adminClient.auth.admin.deleteUser(created.user.id);
    return NextResponse.json(
      { error: `Failed to create profile: ${profileError.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}