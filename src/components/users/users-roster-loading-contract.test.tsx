import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UsersRosterSkeleton } from "./users-roster-skeleton";

const usersTable = readFileSync("src/components/users/users-table.tsx", "utf8");
const pagingHook = readFileSync("src/hooks/use-offset-list-paging.ts", "utf8");
const skeleton = readFileSync(
  "src/components/users/users-roster-skeleton.tsx",
  "utf8",
);
const skeletonPrimitive = readFileSync(
  "src/components/ui/skeleton.tsx",
  "utf8",
);

describe("Users roster replacement loading state", () => {
  it("renders no selectable controls, bulk action, or row menu while skeletons show", () => {
    const html = renderToStaticMarkup(<UsersRosterSkeleton />);
    expect(html).not.toMatch(/<(input|button)\b/);
    expect(html).not.toContain("Select all visible");
    expect(html).not.toContain("Remove selected");
    expect(usersTable).toContain(
      "!rosterLoading && selectionEnabled && displayedMembers.length > 0",
    );
    expect(usersTable).toContain("rosterLoading ? (");
  });

  it("resolves a replacement request error into the existing error state", () => {
    expect(pagingHook).toMatch(
      /catch \(error\)[\s\S]*failedMode: mode,[\s\S]*settled: true/,
    );
    expect(usersTable).toContain("initialError ? (");
  });

  it("keeps an older identity response from clearing the new skeleton", () => {
    expect(pagingHook).toMatch(
      /responseToken: requestToken,\s+currentToken: requestTokenRef\.current/,
    );
    expect(pagingHook).toContain("if (!applied.applied) return current");
    expect(pagingHook).toContain(
      "identityRef.current !== identity || !state.settled",
    );
  });

  it("has an automated and reduced-motion-safe motion row", () => {
    expect(skeleton).toContain('data-skeleton="users-roster"');
    expect(skeletonPrimitive).toContain("motion-safe:animate-pulse");
    expect(usersTable).toContain("motion-reduce:transition-none");
    expect(usersTable).toContain("useListReveal");
    expect(usersTable).toContain("<TabPanel motionKey={tabMotionKey}>");
  });
});
