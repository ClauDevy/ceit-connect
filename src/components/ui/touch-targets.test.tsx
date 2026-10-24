import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";
import { Input } from "./input";

vi.mock("@/lib/utils", () => ({
  cn: (...values: Array<string | undefined>) => values.filter(Boolean).join(" "),
}));

describe("phone touch target markup", () => {
  it("renders buttons and inputs with 44px minimum sizing", () => {
    const markup = renderToStaticMarkup(
      <>
        <Button>Action</Button>
        <Input aria-label="Search" type="search" />
      </>,
    );

    expect(markup).toContain("min-h-11");
    expect(markup.match(/min-h-11/g)).toHaveLength(2);
  });
});
