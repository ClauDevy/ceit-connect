export const DRIVE_ITEM_TYPES = [
  "file",
  "folder",
  "document",
  "spreadsheet",
  "presentation",
] as const;

export type DriveItemType = (typeof DRIVE_ITEM_TYPES)[number];

export interface ParsedDriveLink {
  id: string;
  type: DriveItemType;
  openUrl: string;
  previewUrl: string | null;
}

const DRIVE_HOST = "drive.google.com";
const DOCS_HOST = "docs.google.com";
const DRIVE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const RESOURCE_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

function isValidDriveId(value: string | undefined): value is string {
  return Boolean(value && value.length <= 200 && DRIVE_ID_PATTERN.test(value));
}

function parseDrivePath(url: URL): Pick<ParsedDriveLink, "id" | "type"> | null {
  const segments = url.pathname.split("/").filter(Boolean);

  if (
    segments.length === 4 &&
    segments[0] === "file" &&
    segments[1] === "d" &&
    isValidDriveId(segments[2]) &&
    segments[3] === "view"
  ) {
    return { id: segments[2], type: "file" };
  }

  if (segments.length === 1 && segments[0] === "open") {
    const id = url.searchParams.get("id") ?? undefined;
    return isValidDriveId(id) ? { id, type: "file" } : null;
  }

  const folderId =
    segments[0] === "drive" && segments[1] === "folders"
      ? segments[2]
      : segments[0] === "drive" &&
          segments[1] === "u" &&
          /^\d+$/.test(segments[2] ?? "") &&
          segments[3] === "folders"
        ? segments[4]
        : undefined;

  const hasFolderShape =
    (segments.length === 3 && segments[0] === "drive") ||
    (segments.length === 5 && segments[0] === "drive");

  return hasFolderShape && isValidDriveId(folderId)
    ? { id: folderId, type: "folder" }
    : null;
}

function parseDocsPath(url: URL): Pick<ParsedDriveLink, "id" | "type"> | null {
  const segments = url.pathname.split("/").filter(Boolean);
  const typeByResource = {
    document: "document",
    spreadsheets: "spreadsheet",
    presentation: "presentation",
  } as const;
  const type = typeByResource[segments[0] as keyof typeof typeByResource];
  const id = segments[1] === "d" ? segments[2] : undefined;

  return type &&
    segments.length === 4 &&
    segments[3] === "edit" &&
    isValidDriveId(id)
    ? { id, type }
    : null;
}

function buildSafeUrls(
  parsed: Pick<ParsedDriveLink, "id" | "type">,
  resourceKey: string | null,
): ParsedDriveLink {
  const encodedId = encodeURIComponent(parsed.id);
  const resourceKeyQuery = resourceKey
    ? `?resourcekey=${encodeURIComponent(resourceKey)}`
    : "";

  switch (parsed.type) {
    case "folder":
      return {
        ...parsed,
        openUrl: `https://${DRIVE_HOST}/drive/folders/${encodedId}${resourceKeyQuery}`,
        previewUrl: null,
      };
    case "document":
      return {
        ...parsed,
        openUrl: `https://${DOCS_HOST}/document/d/${encodedId}/edit${resourceKeyQuery}`,
        previewUrl: `https://${DOCS_HOST}/document/d/${encodedId}/preview${resourceKeyQuery}`,
      };
    case "spreadsheet":
      return {
        ...parsed,
        openUrl: `https://${DOCS_HOST}/spreadsheets/d/${encodedId}/edit${resourceKeyQuery}`,
        previewUrl: `https://${DOCS_HOST}/spreadsheets/d/${encodedId}/preview${resourceKeyQuery}`,
      };
    case "presentation":
      return {
        ...parsed,
        openUrl: `https://${DOCS_HOST}/presentation/d/${encodedId}/edit${resourceKeyQuery}`,
        previewUrl: `https://${DOCS_HOST}/presentation/d/${encodedId}/preview${resourceKeyQuery}`,
      };
    case "file":
      return {
        ...parsed,
        openUrl: `https://${DRIVE_HOST}/file/d/${encodedId}/view${resourceKeyQuery}`,
        previewUrl: `https://${DRIVE_HOST}/file/d/${encodedId}/preview${resourceKeyQuery}`,
      };
  }
}

export function parseGoogleDriveLink(value: string): ParsedDriveLink | null {
  const trimmedValue = value.trim();
  if (!trimmedValue) return null;

  let url: URL;
  try {
    url = new URL(trimmedValue);
  } catch {
    return null;
  }

  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    (url.hostname !== DRIVE_HOST && url.hostname !== DOCS_HOST)
  ) {
    return null;
  }

  const parsed =
    url.hostname === DRIVE_HOST ? parseDrivePath(url) : parseDocsPath(url);
  const resourceKey = url.searchParams.get("resourcekey");

  if (
    resourceKey !== null &&
    (resourceKey.length > 200 || !RESOURCE_KEY_PATTERN.test(resourceKey))
  ) {
    return null;
  }

  return parsed ? buildSafeUrls(parsed, resourceKey) : null;
}

export function toPreviewUrl(shareUrl: string): string | null {
  return parseGoogleDriveLink(shareUrl)?.previewUrl ?? null;
}

export function defaultDriveLinkName(type: DriveItemType): string {
  const labels: Record<DriveItemType, string> = {
    file: "Google Drive file",
    folder: "Google Drive folder",
    document: "Google Doc",
    spreadsheet: "Google Sheet",
    presentation: "Google Slides presentation",
  };

  return labels[type];
}
