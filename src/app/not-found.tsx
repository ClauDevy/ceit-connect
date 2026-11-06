import Link from "next/link";
import { OopsPanel } from "@/components/shared/oops-panel";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <OopsPanel
      title="Page not found"
      description="We couldn't find that page. It may have moved, or the link may be old."
      actions={
        <Link href="/home" className={buttonVariants()}>
          Go Home
        </Link>
      }
    />
  );
}
