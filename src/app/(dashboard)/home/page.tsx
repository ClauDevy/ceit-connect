import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { buttonVariants } from "@/components/ui/button";
import { getActiveProfileForRoles } from "@/lib/auth";

// Intentionally empty: this page's content hasn't been built yet.
export default async function HomePage() {
  const leadershipProfile = await getActiveProfileForRoles(["Admin", "Co-Admin"]);

  return (
    <PageHeader
      title="Home"
      actions={
        leadershipProfile ? (
          <Link
            href="/events/new"
            aria-label="Create event"
            title="Create event"
            className={buttonVariants({ size: "icon" })}
          >
            <Plus aria-hidden />
          </Link>
        ) : null
      }
    />
  );
}
