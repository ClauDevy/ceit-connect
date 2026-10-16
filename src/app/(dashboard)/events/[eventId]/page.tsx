import { Suspense } from "react";
import { redirect } from "next/navigation";
import {
  EventBoard,
  isBoardTask,
  type BoardCommittee,
  type BoardEvent,
  type BoardTask,
} from "@/components/events/event-board";
import { EventBoardSkeleton } from "@/components/events/event-board-skeleton";
import { getActiveProfileForRoles, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function BoardData({
  event,
  isAdmin,
}: {
  event: BoardEvent;
  isAdmin: boolean;
}) {
  const supabase = await createClient();
  const boardPromise = supabase.rpc("list_event_board_tasks", {
    p_event_id: event.id,
    p_committee_id: null,
  });
  const committeesPromise = isAdmin
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
      isAdmin={isAdmin}
      committees={committeesResult.data ?? []}
      initialTasks={boardData}
    />
  );
}

export default async function EventBoardPage({
  params,
}: PageProps<"/events/[eventId]">) {
  await requireUser();
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
    <Suspense fallback={<EventBoardSkeleton />}>
      <BoardData event={event} isAdmin={profile.role === "Admin"} />
    </Suspense>
  );
}
