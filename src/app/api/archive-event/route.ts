import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const { data: requester, error: requesterError } = await supabase
    .from("users")
    .select("role, is_active")
    .eq("id", user.id)
    .single();

  if (requesterError) {
    console.error("Failed to verify archive requester:", requesterError);
    return NextResponse.json(
      { error: "Your account could not be verified. Try again." },
      { status: 500 },
    );
  }

  if (!requester.is_active || requester.role !== "Admin") {
    return NextResponse.json(
      { error: "Only active Admins can archive events." },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const eventId =
    typeof body === "object" && body !== null && "eventId" in body
      ? (body as { eventId?: unknown }).eventId
      : null;

  if (typeof eventId !== "string" || !UUID_PATTERN.test(eventId)) {
    return NextResponse.json(
      { error: "A valid event ID is required." },
      { status: 400 },
    );
  }

  const { data: updatedEvents, error: updateError } = await supabase
    .from("events")
    .update({ status: "Archived" })
    .eq("id", eventId)
    .eq("status", "Active")
    .select("id");

  if (updateError) {
    console.error("Failed to archive event:", updateError);
    return NextResponse.json(
      { error: "The event could not be archived. Refresh and try again." },
      { status: 409 },
    );
  }

  if (updatedEvents.length !== 1) {
    const { data: event, error: lookupError } = await supabase
      .from("events")
      .select("status")
      .eq("id", eventId)
      .maybeSingle();

    if (lookupError) {
      console.error("Failed to diagnose archive result:", lookupError);
      return NextResponse.json(
        { error: "The archive result could not be verified. Refresh and try again." },
        { status: 500 },
      );
    }

    if (!event) {
      return NextResponse.json({ error: "Event not found." }, { status: 404 });
    }

    if (event.status === "Draft") {
      return NextResponse.json(
        { error: "Draft events cannot be archived. Launch the event first." },
        { status: 409 },
      );
    }

    if (event.status === "Archived") {
      return NextResponse.json(
        { error: "This event is already archived." },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: "The event was not archived. Refresh and try again." },
      { status: 409 },
    );
  }

  return NextResponse.json({ success: true });
}
