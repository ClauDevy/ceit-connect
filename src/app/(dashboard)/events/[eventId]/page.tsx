import { Suspense } from "react";
import { redirect } from "next/navigation";
import { EventBoard } from "@/components/events/event-board";
import { EventBoardSkeleton } from "@/components/events/event-board-skeleton";
import { getActiveProfileForRoles, requireUser } from "@/lib/auth";
import {
  isBoardTask,
  type BoardCommittee,
  type BoardEvent,
  type BoardTask,
} from "@/lib/events/board";
import { createClient } from "@/lib/supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  const committeesPromise = viewer.role === "Admin"
    ? supabase
        .from("committees")
        .select("id, name")
        .order("name")
        .returns<BoardCommittee[]>()
    : Promise.resolve({ data: [] as BoardCommittee[], error: null });

  const [boardResult, committeesResult] = await Promise.all([
    boardPromise,
    committeesPromise,
  ]);

  if (boardResult.error) {
    console.error("Failed to load event board tasks:", boardResult.error);
  }
  const boardData: BoardTask[] | undefined =
    !boardResult.error &&
    Array.isArray(boardResult.data) &&
    boardResult.data.every(isBoardTask)
      ? boardResult.data
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

  return (
    <EventBoard
      event={event}
      viewer={viewer}
      committees={committeesResult.data ?? []}
      initialTasks={boardData}
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
  if (!UUID_PATTERN.test(eventId)) redirect("/home");

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
    <div className="w-full min-w-0">
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
