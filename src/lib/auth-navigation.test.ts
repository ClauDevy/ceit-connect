import { describe, expect, it, vi } from "vitest";
import { finishAuthentication } from "./auth-navigation";

describe("finishAuthentication", () => {
  it("replaces the auth screen with home, then refreshes the route cache", () => {
    const replace = vi.fn();
    const refresh = vi.fn();

    finishAuthentication({ replace, refresh });

    expect(replace).toHaveBeenCalledWith("/home");
    expect(replace.mock.invocationCallOrder[0]).toBeLessThan(
      refresh.mock.invocationCallOrder[0],
    );
  });
});
