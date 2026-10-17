export type TaskWorkLink = {
  id: string;
  name: string | null;
  url: string;
  created_at: string;
  can_remove: boolean;
};

export type TaskWorkLinks = {
  can_add: boolean;
  links: TaskWorkLink[];
};

function isTaskWorkLink(value: unknown): value is TaskWorkLink {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;

  return (
    typeof row.id === "string" &&
    (typeof row.name === "string" || row.name === null) &&
    typeof row.url === "string" &&
    typeof row.created_at === "string" &&
    typeof row.can_remove === "boolean"
  );
}

export function isTaskWorkLinks(value: unknown): value is TaskWorkLinks {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;

  return (
    typeof row.can_add === "boolean" &&
    Array.isArray(row.links) &&
    row.links.every(isTaskWorkLink)
  );
}

type WorkLinkAction = "add" | "remove";

export function getWorkLinkErrorMessage(
  error: unknown,
  action: WorkLinkAction,
) {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";

  if (code === "23505") return "This Drive link is already saved.";
  if (code === "CCL04") return "This task already has 20 work links.";
  if (code === "22023") {
    return "Paste a valid canonical HTTPS Google Drive, Docs, Sheets, or Slides link.";
  }
  if (code === "CCL03") {
    return "This task is archived, so its work links are read only.";
  }
  if (code === "42501") {
    return `You no longer have permission to ${action} this work link.`;
  }

  return action === "add"
    ? "The link could not be added. Please try again."
    : "The link could not be removed. Please try again.";
}
