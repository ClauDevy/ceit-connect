export const MAX_BANNER_BYTES = 1.5 * 1024 * 1024;
export const STALE_BANNER_MESSAGE =
  "This event changed since you opened it. Reload to continue.";

type BannerResponse = {
  bannerUrl: string | null;
  updatedAt: string;
  cleanupPending: boolean;
};

async function readResponse(response: Response): Promise<BannerResponse> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : "The banner could not be saved. Try again.";
    throw new Error(message);
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("bannerUrl" in body) ||
    !(
      typeof (body as { bannerUrl?: unknown }).bannerUrl === "string" ||
      (body as { bannerUrl?: unknown }).bannerUrl === null
    ) ||
    typeof (body as { updatedAt?: unknown }).updatedAt !== "string" ||
    typeof (body as { cleanupPending?: unknown }).cleanupPending !== "boolean"
  ) {
    throw new Error("The banner server returned an invalid response.");
  }

  return body as BannerResponse;
}

export async function uploadEventBanner(
  eventId: string,
  expectedUpdatedAt: string,
  file: File,
) {
  const formData = new FormData();
  formData.set("eventId", eventId);
  formData.set("expectedUpdatedAt", expectedUpdatedAt);
  formData.set("banner", file);

  const response = await fetch("/api/event-banner", {
    method: "POST",
    body: formData,
  });
  return readResponse(response);
}

export async function removeEventBanner(
  eventId: string,
  expectedUpdatedAt: string,
) {
  const response = await fetch("/api/event-banner", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventId, expectedUpdatedAt }),
  });
  return readResponse(response);
}
