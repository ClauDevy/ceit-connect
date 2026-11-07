import { Suspense } from "react";
import { redirect } from "next/navigation";
import { EventBoard } from "@/components/events/event-board";
import { EventBoardSkeleton } from "@/components/events/event-board-skeleton";
import { getActiveProfileForRoles, requireUser } from "@/lib/auth";
import {
  parseBoardTask,
  type BoardCommittee,
  type BoardEvent,
  type BoardTask,
} from "@/lib/events/board";
import { parseEventAutoArchiveWarning } from "@/lib/events/auto-archive-warning";
import { createClient } from "@/lib/supabase/server";
import { isCanonicalUuid } from "@/lib/uuid";

export const dynamic = "force-dynamic";

async function BoardData({
  event,
  viewer,
}: {
  event: BoardEvent;
  viewer: {
    id: string;
    role: "Admin" | "Co-Admin" | "Member";
    committeeId: string | null;
  };
}) {
  const supabase = await createClient();
  const boardPromise = supabase.rpc("list_event_board_tasks", {
    p_event_id: event.id,
    p_committee_id: null,
  });
  const committeesPromise = viewer.role !== "Member"
    ? supabase
        .from("committees")
        .select("id, name")
        .order("name")
        .returns<BoardCommittee[]>()
    : Promise.resolve({ data: [] as BoardCommittee[], error: null });
  const warningPromise = supabase.rpc("get_event_auto_archive_warning", {
    p_event_id: event.id,
  });

  const [boardResult, committeesResult, warningResult] = await Promise.all([
    boardPromise,
    committeesPromise,
    warningPromise,
  ]);

  if (boardResult.error) {
    console.error("Failed to load event board tasks:", boardResult.error);
  }
  const parsedBoard = Array.isArray(boardResult.data)
    ? boardResult.data.map(parseBoardTask)
    : [];
  const boardData: BoardTask[] | undefined = !boardResult.error &&
    Array.isArray(boardResult.data) && parsedBoard.every((task) => task !== null)
      ? parsedBoard as BoardTask[]
      : undefined;
  if (!boardResult.error && boardData === undefined) {
    console.error("Event board tasks returned invalid data.");
  }
  if (committeesResult.error) {
    console.error(
      "Failed to load board committee filters:",
      committeesResult.error,
    );
  }
  if (warningResult.error) {
    console.error("Failed to load event auto-archive warning:", {
      code: warningResult.error.code,
    });
  }
  const autoArchiveWarning = warningResult.error
    ? null
    : parseEventAutoArchiveWarning(warningResult.data);
  const warningPayloadPresent = Array.isArray(warningResult.data)
    ? warningResult.data.length > 0
    : warningResult.data !== null && warningResult.data !== undefined;
  if (!warningResult.error && warningPayloadPresent && !autoArchiveWarning) {
    console.error("Event auto-archive warning returned invalid data.");
  }

  return (
    <EventBoard
      event={event}
      viewer={viewer}
      committees={(committeesResult.data ?? []).filter(
        (committee) =>
          viewer.role === "Admin" || committee.id === viewer.committeeId,
      )}
      initialTasks={boardData}
      autoArchiveWarning={autoArchiveWarning}
    />
  );
}

export default async function EventBoardPage({
  params,
}: PageProps<"/events/[eventId]">) {
  const user = await requireUser();
  const profile = await getActiveProfileForRoles([
    "Admin",
    "Co-Admin",
    "Member",
  ]);
  if (!profile) redirect("/home");

  const { eventId } = await params;
  if (!isCanonicalUuid(eventId)) redirect("/home");

  const supabase = await createClient();
  const { data: event, error } = await supabase
    .from("events")
    .select("id, name, description, start_date, end_date, banner_url")
    .eq("id", eventId)
    .eq("status", "Active")
    .maybeSingle<BoardEvent>();

  if (error) {
    console.error("Failed to load board event:", error);
    redirect("/home");
  }
  if (!event) redirect("/home");

  return (
    <div className="motion-content-ready w-full min-w-0">
      <Suspense fallback={<EventBoardSkeleton />}>
        <BoardData
          event={event}
          viewer={{
            id: user.id,
            role: profile.role,
            committeeId: profile.committee_id,
          }}
        />
      </Suspense>
    </div>
  );
}
