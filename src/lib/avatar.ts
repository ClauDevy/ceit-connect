export const AVATAR_FILE_NAME = "avatar.webp";

type AvatarObject = {
  name: string;
  updated_at?: string | null;
  created_at?: string | null;
};

export function avatarObjectPath(userId: string) {
  return `${userId}/${AVATAR_FILE_NAME}`;
}

export function findAvatarObject(objects: AvatarObject[] | null) {
  return objects?.find((object) => object.name === AVATAR_FILE_NAME) ?? null;
}

export function buildVersionedAvatarUrl(
  publicUrl: string,
  object: AvatarObject,
  serverTime = new Date(),
) {
  const version = object.updated_at || object.created_at || serverTime.toISOString();
  const url = new URL(publicUrl);
  url.searchParams.set("v", version);
  return url.toString();
}

export function nextAvatarCleanupWarning(
  currentWarning: string,
  response: unknown,
) {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    return currentWarning;
  }

  const { cleanupPending, warning } = response as Record<string, unknown>;

  if (cleanupPending === false) {
    return "";
  }

  if (
    cleanupPending === true &&
    typeof warning === "string" &&
    warning.trim().length > 0
  ) {
    return warning;
  }

  return currentWarning;
}
