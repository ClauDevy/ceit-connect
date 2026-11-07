import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InlineAlert } from "./inline-alert";

describe("InlineAlert", () => {
  it("renders a warning as a readable status with semantic warning styling", () => {
    const html = renderToStaticMarkup(
      <InlineAlert variant="warning">Archives soon</InlineAlert>,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("Archives soon");
    expect(html).toContain("bg-primary/10");
  });
});
