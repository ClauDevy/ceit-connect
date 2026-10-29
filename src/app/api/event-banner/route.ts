import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

// These strict event-ID and banner-file checks mirror
// public.can_write_event_banner_object() and must change with that function.
const UUID_SOURCE =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const UUID_PATTERN = new RegExp(`^${UUID_SOURCE}$`, "i");
const MAX_BANNER_BYTES = 1.5 * 1024 * 1024;
const STALE_MESSAGE =
  "This event changed since you opened it. Reload to continue.";

type EditableEvent = {
  id: string;
  status: "Draft" | "Active" | "Archived";
  banner_url: string | null;
  updated_at: string;
};

function objectPathFromUrl(eventId: string, bannerUrl: string | null) {
  if (!bannerUrl) return null;

  try {
    const url = new URL(bannerUrl);
    // This stored banner filename check mirrors
    // public.event_banner_url_is_valid() and must change with that function.
    const match = url.pathname.match(
      new RegExp(
        `^/storage/v1/object/public/banners/(${UUID_SOURCE})/(${UUID_SOURCE}\\.webp)$`,
        "i",
      ),
    );

    if (!match || match[1].toLowerCase() !== eventId.toLowerCase()) return null;
    return `${match[1]}/${match[2]}`;
  } catch {
    return null;
  }
}

async function verifyRequester() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      error: NextResponse.json(
        { error: "You must be signed in." },
        { status: 401 },
      ),
    } as const;
  }

  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("role, is_active")
    .eq("id", user.id)
    .single();

  if (profileError) {
    console.error("Failed to verify banner requester:", profileError);
    return {
      error: NextResponse.json(
        { error: "Your account could not be verified. Try again." },
        { status: 500 },
      ),
    } as const;
  }

  if (
    !profile.is_active ||
    (profile.role !== "Admin" && profile.role !== "Co-Admin")
  ) {
    return {
      error: NextResponse.json(
        { error: "Only active Admins and Co-Admins can change event banners." },
        { status: 403 },
      ),
    } as const;
  }

  return { supabase } as const;
}

async function loadEditableEvent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
) {
  return supabase
    .from("events")
    .select("id, status, banner_url, updated_at")
    .eq("id", eventId)
    .maybeSingle<EditableEvent>();
}

async function cleanupUnusedBanner(
  eventId: string,
  objectPath: string,
  objectUrl: string,
) {
  const adminClient = await createServiceRoleClient();
  const { data: event, error: eventError } = await adminClient
    .from("events")
    .select("status, banner_url")
    .eq("id", eventId)
    .maybeSingle<{ status: string; banner_url: string | null }>();

  if (eventError) {
    console.error("Failed to verify banner cleanup target:", eventError);
    return false;
  }

  if (!event || event.status === "Archived" || event.banner_url === objectUrl) {
    return false;
  }

  const { data: cleanedObjects, error: cleanupError } =
    await adminClient.storage.from("banners").remove([objectPath]);

  if (cleanupError || !cleanedObjects?.length) {
    console.error("Failed to clean up unused banner:", cleanupError);
    return false;
  }

  return true;
}

async function removeUnusedBanner(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
  objectPath: string,
  objectUrl: string,
) {
  const { data: removedObjects, error } = await supabase.storage
    .from("banners")
    .remove([objectPath]);
  if (!error && removedObjects?.length) return true;

  console.error("Caller-scoped banner cleanup failed:", error);
  return cleanupUnusedBanner(eventId, objectPath, objectUrl);
}

function parseEventVersion(formData: FormData) {
  const eventId = formData.get("eventId");
  const expectedUpdatedAt = formData.get("expectedUpdatedAt");

  if (
    typeof eventId !== "string" ||
    !UUID_PATTERN.test(eventId) ||
    typeof expectedUpdatedAt !== "string" ||
    expectedUpdatedAt.length === 0
  ) {
    return null;
  }

  return { eventId, expectedUpdatedAt };
}

export async function POST(request: Request) {
  const requester = await verifyRequester();
  if ("error" in requester) return requester.error;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  const eventVersion = parseEventVersion(formData);
  const file = formData.get("banner");
  if (!eventVersion || !(file instanceof File)) {
    return NextResponse.json(
      { error: "A valid event, version, and banner are required." },
      { status: 400 },
    );
  }

  if (
    file.type !== "image/webp" ||
    file.size === 0 ||
    file.size > MAX_BANNER_BYTES
  ) {
    return NextResponse.json(
      { error: "The processed banner must be a WebP image under 1.5 MB." },
      { status: 400 },
    );
  }

  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const isWebP =
    header.length === 12 &&
    String.fromCharCode(...header.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...header.slice(8, 12)) === "WEBP";
  if (!isWebP) {
    return NextResponse.json(
      { error: "The processed banner is not a valid WebP image." },
      { status: 400 },
    );
  }

  const { eventId, expectedUpdatedAt } = eventVersion;
  const { data: event, error: eventError } = await loadEditableEvent(
    requester.supabase,
    eventId,
  );

  if (eventError) {
    console.error("Failed to load event for banner upload:", eventError);
    return NextResponse.json(
      { error: "The event could not be verified. Try again." },
      { status: 500 },
    );
  }

  if (!event) {
    return NextResponse.json({ error: "Event not found." }, { status: 404 });
  }
  if (event.status === "Archived") {
    return NextResponse.json(
      { error: "Archived events are read-only." },
      { status: 409 },
    );
  }
  if (event.updated_at !== expectedUpdatedAt) {
    return NextResponse.json({ error: STALE_MESSAGE }, { status: 409 });
  }

  const objectPath = `${eventId}/${crypto.randomUUID()}.webp`;
  const { error: uploadError } = await requester.supabase.storage
    .from("banners")
    .upload(objectPath, file, { contentType: "image/webp", upsert: false });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 400 });
  }

  const {
    data: { publicUrl },
  } = requester.supabase.storage.from("banners").getPublicUrl(objectPath);

  const { data: updatedRows, error: updateError } = await requester.supabase
    .from("events")
    .update({ banner_url: publicUrl })
    .eq("id", eventId)
    .eq("updated_at", expectedUpdatedAt)
    .in("status", ["Draft", "Active"])
    .select("updated_at");

  if (updateError || updatedRows.length !== 1) {
    if (updateError) {
      console.error("Failed to save event banner URL:", updateError);
    }
    const cleaned = await removeUnusedBanner(
      requester.supabase,
      eventId,
      objectPath,
      publicUrl,
    );
    if (!cleaned) {
      console.error(
        "The failed banner upload could not be cleaned up:",
        objectPath,
      );
    }

    return NextResponse.json(
      {
        error: updateError
          ? "The banner could not be saved. Try again."
          : STALE_MESSAGE,
      },
      { status: updateError ? 500 : 409 },
    );
  }

  let cleanupPending = false;
  const oldObjectPath = objectPathFromUrl(eventId, event.banner_url);
  if (oldObjectPath && event.banner_url) {
    cleanupPending = !(await removeUnusedBanner(
      requester.supabase,
      eventId,
      oldObjectPath,
      event.banner_url,
    ));
  }

  return NextResponse.json({
    bannerUrl: publicUrl,
    updatedAt: updatedRows[0].updated_at,
    cleanupPending,
  });
}

export async function DELETE(request: Request) {
  const requester = await verifyRequester();
  if ("error" in requester) return requester.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  const eventId =
    typeof body === "object" && body !== null && "eventId" in body
      ? (body as { eventId?: unknown }).eventId
      : null;
  const expectedUpdatedAt =
    typeof body === "object" && body !== null && "expectedUpdatedAt" in body
      ? (body as { expectedUpdatedAt?: unknown }).expectedUpdatedAt
      : null;

  if (
    typeof eventId !== "string" ||
    !UUID_PATTERN.test(eventId) ||
    typeof expectedUpdatedAt !== "string" ||
    expectedUpdatedAt.length === 0
  ) {
    return NextResponse.json(
      { error: "A valid event ID and version are required." },
      { status: 400 },
    );
  }

  const { data: event, error: eventError } = await loadEditableEvent(
    requester.supabase,
    eventId,
  );
  if (eventError) {
    console.error("Failed to load event for banner removal:", eventError);
    return NextResponse.json(
      { error: "The event could not be verified. Try again." },
      { status: 500 },
    );
  }
  if (!event) {
    return NextResponse.json({ error: "Event not found." }, { status: 404 });
  }
  if (event.status === "Archived") {
    return NextResponse.json(
      { error: "Archived events are read-only." },
      { status: 409 },
    );
  }
  if (event.updated_at !== expectedUpdatedAt) {
    return NextResponse.json({ error: STALE_MESSAGE }, { status: 409 });
  }

  const { data: updatedRows, error: updateError } = await requester.supabase
    .from("events")
    .update({ banner_url: null })
    .eq("id", eventId)
    .eq("updated_at", expectedUpdatedAt)
    .in("status", ["Draft", "Active"])
    .select("updated_at");

  if (updateError) {
    console.error("Failed to clear event banner URL:", updateError);
    return NextResponse.json(
      { error: "The banner could not be removed. Try again." },
      { status: 500 },
    );
  }
  if (updatedRows.length !== 1) {
    return NextResponse.json({ error: STALE_MESSAGE }, { status: 409 });
  }

  let cleanupPending = false;
  const oldObjectPath = objectPathFromUrl(eventId, event.banner_url);
  if (oldObjectPath && event.banner_url) {
    cleanupPending = !(await removeUnusedBanner(
      requester.supabase,
      eventId,
      oldObjectPath,
      event.banner_url,
    ));
  }

  return NextResponse.json({
    bannerUrl: null,
    updatedAt: updatedRows[0].updated_at,
    cleanupPending,
  });
}
