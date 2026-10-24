import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import HomeLoading from "../../app/(dashboard)/home/loading";
import { DrivePreview } from "../tasks/drive-preview";
import { TaskDetailSkeleton } from "../tasks/task-detail-skeleton";
import {
  PageSkeleton,
  SettingsSkeleton,
  TableSkeleton,
} from "./page-skeleton";
import { StretchedLink } from "./stretched-link";

vi.mock("@/lib/utils", () => ({
  cn: (...values: Array<string | undefined>) => values.filter(Boolean).join(" "),
}));

vi.mock("@/lib/google-drive", () => ({
  parseGoogleDriveLink: () => ({
    openUrl: "https://drive.google.com/open?id=file-123",
    previewUrl: "https://drive.google.com/file/d/file-123/preview",
    type: "file",
  }),
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children, ...props }: React.ComponentProps<"div">) => (
    <div {...props}>{children}</div>
  ),
  CardContent: ({ children, ...props }: React.ComponentProps<"div">) => (
    <div {...props}>{children}</div>
  ),
}));

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: (props: React.ComponentProps<"div">) => <div {...props} />,
}));

vi.mock("@/components/shared/page-skeleton", () => ({
  PageHeaderSkeleton: ({ withAction }: { withAction?: boolean }) => (
    <div>
      <div className="h-8 w-48" />
      {withAction ? <div className="h-11 w-36 md:h-9" /> : null}
    </div>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    render,
    nativeButton: _nativeButton,
    ...props
  }: React.ComponentProps<"button"> & {
    render?: React.ReactElement;
    nativeButton?: boolean;
  }) => {
    void _nativeButton;
    return render ? (
      <a
        {...(render.props as React.AnchorHTMLAttributes<HTMLAnchorElement>)}
        className={props.className}
      >
        {children}
      </a>
    ) : (
      <button {...props}>{children}</button>
    );
  },
}));

describe("Part C markup regressions", () => {
  it("keeps a stretched navigation link separate from its sibling action", () => {
    const markup = renderToStaticMarkup(
      <div className="relative">
        <StretchedLink href="/tasks/task-1" label="Open task" />
        <button className="relative z-20">Edit</button>
      </div>,
    );

    expect(markup).toContain("absolute inset-0 z-10");
    expect(markup).toContain("focus-visible:ring-2");
    expect(markup).toContain("focus-visible:ring-inset");
    expect(markup).toContain("focus-visible:ring-ring");
    expect(markup).not.toContain("ring-offset");
    expect(markup).toContain("relative z-20");
    expect(markup).not.toMatch(/<a[^>]*>[^]*<button[^>]*>[^]*<\/a>/);
  });

  it("keeps Drive previews contained to their available width", () => {
    const markup = renderToStaticMarkup(
      <DrivePreview url="https://drive.google.com/file/d/file-123/view" />,
    );

    expect(markup).toContain("max-w-full");
    expect(markup).toContain("overflow-hidden");
    expect(markup).toContain("aspect-[3/4]");
    expect(markup).toContain("sm:aspect-[16/10]");
    expect(markup).toContain("Preview unavailable?");
    expect(markup).toContain("Open link");
  });

  it("renders distinct structures for every current route loading state", () => {
    const dashboard = renderToStaticMarkup(<PageSkeleton />);
    const home = renderToStaticMarkup(<HomeLoading />);
    const settings = renderToStaticMarkup(<SettingsSkeleton />);
    const task = renderToStaticMarkup(<TaskDetailSkeleton />);
    const users = renderToStaticMarkup(<TableSkeleton />);

    expect(dashboard).toContain('aria-label="Loading dashboard page"');
    expect(home).toContain("aspect-video");
    expect(home).toContain("w-36");
    expect(settings).toContain('data-skeleton="settings-photo"');
    expect(task).toContain('aria-label="Loading task details"');
    expect(users).toContain('data-skeleton="users-roster"');
  });
});
