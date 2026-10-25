import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LoadMoreControl } from "./load-more-control";

const noop = () => undefined;

describe("LoadMoreControl", () => {
  it("renders nothing before another visible page is proven", () => {
    expect(
      renderToStaticMarkup(
        <LoadMoreControl
          announcement=""
          hasLoadedMore={false}
          hasMore={false}
          isLoading={false}
          onLoadMore={noop}
          onRetry={noop}
        />,
      ),
    ).toBe("");
  });

  it("uses one accessible button for ready, loading, retry, and final states", () => {
    const ready = renderToStaticMarkup(
      <LoadMoreControl
        announcement=""
        hasLoadedMore={false}
        hasMore
        isLoading={false}
        onLoadMore={noop}
        onRetry={noop}
      />,
    );
    const loading = renderToStaticMarkup(
      <LoadMoreControl
        announcement=""
        hasLoadedMore={false}
        hasMore
        isLoading
        onLoadMore={noop}
        onRetry={noop}
      />,
    );
    const retry = renderToStaticMarkup(
      <LoadMoreControl
        announcement=""
        errorMessage="The page failed."
        hasLoadedMore={false}
        hasMore
        isLoading={false}
        onLoadMore={noop}
        onRetry={noop}
      />,
    );
    const final = renderToStaticMarkup(
      <LoadMoreControl
        announcement="1 more event loaded, 21 events loaded."
        hasLoadedMore
        hasMore={false}
        isLoading={false}
        onLoadMore={noop}
        onRetry={noop}
      />,
    );

    for (const markup of [ready, loading, retry, final]) {
      expect(markup.match(/<button/g)).toHaveLength(1);
    }
    expect(ready).toContain("Load more");
    expect(loading).toContain("Loading more...");
    expect(loading).toContain("disabled");
    expect(retry).toContain("Retry");
    expect(final).toContain("All items loaded");
    expect(final).toContain("1 more event loaded, 21 events loaded.");
    expect(final).toContain("disabled");
  });

  it("shows a safe append error and Retry after has-more is cleared", () => {
    const safeMessage =
      "More tasks could not be loaded. The loaded tasks are still shown.";
    const rawError = "PGRST999: internal database failure";
    const markup = renderToStaticMarkup(
      <LoadMoreControl
        announcement=""
        errorMessage={safeMessage}
        hasLoadedMore={false}
        hasMore={false}
        isLoading={false}
        onLoadMore={noop}
        onRetry={noop}
      />,
    );

    expect(markup).toContain(safeMessage);
    expect(markup).toContain("Retry");
    expect(markup).not.toContain(rawError);
  });
});
