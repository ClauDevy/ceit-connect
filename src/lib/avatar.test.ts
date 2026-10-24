import { describe, expect, it } from "vitest";
import {
  avatarObjectPath,
  buildVersionedAvatarUrl,
  findAvatarObject,
} from "./avatar";

describe("avatar URL helpers", () => {
  it("derives the fixed object path from the authenticated user id", () => {
    expect(avatarObjectPath("user-123")).toBe("user-123/avatar.webp");
  });

  it("finds only the fixed avatar filename", () => {
    expect(
      findAvatarObject([
        { name: "old.webp", updated_at: "old" },
        { name: "avatar.webp", updated_at: "new" },
      ]),
    ).toEqual({ name: "avatar.webp", updated_at: "new" });
    expect(findAvatarObject([{ name: "other.webp" }])).toBeNull();
  });

  it("prefers the object's update timestamp for the cache version", () => {
    const url = buildVersionedAvatarUrl(
      "https://storage.example/avatar.webp",
      {
        name: "avatar.webp",
        updated_at: "2026-10-24T12:34:56.000Z",
        created_at: "2026-10-20T00:00:00.000Z",
      },
      new Date("2026-10-25T00:00:00.000Z"),
    );

    expect(new URL(url).searchParams.get("v")).toBe(
      "2026-10-24T12:34:56.000Z",
    );
  });

  it("falls back through created time to server time", () => {
    const created = buildVersionedAvatarUrl(
      "https://storage.example/avatar.webp",
      { name: "avatar.webp", created_at: "2026-10-20T00:00:00.000Z" },
      new Date("2026-10-25T00:00:00.000Z"),
    );
    const server = buildVersionedAvatarUrl(
      "https://storage.example/avatar.webp",
      { name: "avatar.webp" },
      new Date("2026-10-25T00:00:00.000Z"),
    );

    expect(new URL(created).searchParams.get("v")).toBe(
      "2026-10-20T00:00:00.000Z",
    );
    expect(new URL(server).searchParams.get("v")).toBe(
      "2026-10-25T00:00:00.000Z",
    );
  });
});
