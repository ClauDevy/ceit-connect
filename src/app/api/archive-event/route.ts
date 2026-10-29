import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isCanonicalUuid } from "@/lib/uuid";
const TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

const RPC_ERRORS: Record<string, { message: string; status: number }> = {
  CCA01: { message: "Only active Admins can archive events.", status: 403 },
  CCA02: {
    message: "The event ID and expected version are required.",
    status: 400,
  },
  CCA03: {
    message: "Expected incomplete task count must be a non-negative integer.",
    status: 400,
  },
  CCA04: { message: "Event not found.", status: 404 },
  CCA05: {
    message: "Draft events cannot be archived. Launch the event first.",
    status: 409,
  },
  CCA06: { message: "This event is already archived.", status: 409 },
  CCA07: { message: "Only Active events can be archived.", status: 409 },
  CCA08: {
    message:
      "This event changed after you opened the archive confirmation. Refresh and confirm again.",
    status: 409,
  },
  CCA09: {
    message:
      "The incomplete task count changed. Refresh and confirm the archive again.",
    status: 409,
  },
  CCA10: { message: "The event could not be archived.", status: 500 },
};

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
    .maybeSingle();

  if (requesterError) {
    console.error("Failed to verify archive requester:", requesterError);
    return NextResponse.json(
      { error: "Your account could not be verified. Try again." },
      { status: 500 },
    );
  }

  if (!requester || !requester.is_active || requester.role !== "Admin") {
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

  const requestBody =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : null;
  const eventId = requestBody?.eventId;
  const expectedIncompleteTaskCount = requestBody?.expectedIncompleteTaskCount;
  const expectedUpdatedAt = requestBody?.expectedUpdatedAt;

  if (!isCanonicalUuid(eventId)) {
    return NextResponse.json(
      { error: "A valid event ID is required." },
      { status: 400 },
    );
  }

  if (
    typeof expectedIncompleteTaskCount !== "number" ||
    !Number.isSafeInteger(expectedIncompleteTaskCount) ||
    expectedIncompleteTaskCount < 0
  ) {
    return NextResponse.json(
      { error: "A valid expected incomplete task count is required." },
      { status: 400 },
    );
  }

  if (
    typeof expectedUpdatedAt !== "string" ||
    !TIMESTAMP_PATTERN.test(expectedUpdatedAt)
  ) {
    return NextResponse.json(
      { error: "A valid event version is required." },
      { status: 400 },
    );
  }

  const { error: archiveError } = await supabase.rpc("archive_event", {
    p_event_id: eventId,
    p_expected_incomplete_task_count: expectedIncompleteTaskCount,
    // Keep the original database string intact; JS Date loses microseconds.
    p_expected_updated_at: expectedUpdatedAt,
  });

  if (archiveError) {
    const mappedError = RPC_ERRORS[archiveError.code];
    if (mappedError) {
      return NextResponse.json(
        { error: mappedError.message },
        { status: mappedError.status },
      );
    }

    console.error("Failed to archive event:", archiveError);
    return NextResponse.json(
      { error: "The event could not be archived. Refresh and try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
