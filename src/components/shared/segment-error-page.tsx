"use client";

import Link from "next/link";
import { OopsPanel } from "@/components/shared/oops-panel";
import { Button, buttonVariants } from "@/components/ui/button";

// Shows a friendly message only; the raw error is never displayed to people.
// Shared by the root and dashboard error boundaries. Segment boundaries render inside
// the existing layout, so this must not add page-level wrapper tags.
export function SegmentErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <OopsPanel
      title="Something went wrong"
      description="That didn't work as expected. Please try again, or head back Home."
      actions={
        <>
          <Button type="button" onClick={() => reset()}>
            Try again
          </Button>
          <Link href="/home" className={buttonVariants({ variant: "outline" })}>
            Go Home
          </Link>
        </>
      }
    />
  );
}
