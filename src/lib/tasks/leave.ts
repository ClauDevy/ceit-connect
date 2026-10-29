export type TaskLeaveRequest = {
  out_id: string;
  out_task_id: string;
  out_task_title: string;
  out_event_name: string;
  out_requester_id: string;
  out_requester_name: string;
  out_due_date: string | null;
  out_created_at: string;
  out_can_resolve: boolean;
  out_is_requester: boolean;
};

export function isTaskLeaveRequest(value: unknown): value is TaskLeaveRequest {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.out_id === "string" &&
    typeof row.out_task_id === "string" &&
    typeof row.out_task_title === "string" &&
    typeof row.out_event_name === "string" &&
    typeof row.out_requester_id === "string" &&
    typeof row.out_requester_name === "string" &&
    (row.out_due_date === null || typeof row.out_due_date === "string") &&
    typeof row.out_created_at === "string" &&
    typeof row.out_can_resolve === "boolean" &&
    typeof row.out_is_requester === "boolean"
  );
}

export function getTaskLeaveErrorMessage(error: unknown) {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  if (code === "CCL01") return "A leave request is already pending.";
  if (code === "CCL20") return "You have reached the pending leave-request limit.";
  if (code === "CCL02") return "This leave request is no longer pending.";
  if (code === "40001") return "This leave request changed. Refresh and try again.";
  return "The leave request could not be updated. Please try again.";
}

export function isMemberLeaveRequestPrediction(
  viewerRole: "Admin" | "Co-Admin" | "Member",
  selfUnassignBlockCode: string | null,
) {
  return viewerRole === "Member" && selfUnassignBlockCode === "due";
}

export function getTaskLeaveConfirmationDescription(
  viewerRole: "Admin" | "Co-Admin" | "Member",
  selfUnassignBlockCode: string | null,
  willLoseAccess: boolean,
) {
  if (isMemberLeaveRequestPrediction(viewerRole, selfUnassignBlockCode)) {
    return "You are sending a leave request. Your assignment and access will stay unchanged until leadership approves it.";
  }
  return willLoseAccess
    ? "You will be removed from this confidential task and will lose access to its details and work links."
    : "You will be removed from this task. If you are its last primary assignee, it will return to the To Do Backlog.";
}

export function excludeActorFromNewCandidates<T extends { id: string }>(
  candidates: readonly T[],
  stored: readonly T[],
  actorId: string,
) {
  const storedIds = new Set(stored.map((person) => person.id));
  return candidates.filter(
    (person) => person.id !== actorId || storedIds.has(person.id),
  );
}
