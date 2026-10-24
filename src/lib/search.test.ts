import { describe, expect, it, vi } from "vitest";
import { preventSearchFormSubmission } from "./search";

describe("preventSearchFormSubmission", () => {
  it("prevents Enter from submitting a surrounding form", () => {
    const preventDefault = vi.fn();
    preventSearchFormSubmission({ key: "Enter", preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it("leaves ordinary typing unchanged", () => {
    const preventDefault = vi.fn();
    preventSearchFormSubmission({ key: "a", preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
  });
});
