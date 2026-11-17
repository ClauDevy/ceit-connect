import { redirect } from "next/navigation";
import Link from "next/link";
import { HelpManual } from "@/components/help/help-manual";
import { getActiveProfileForRoles, requireUser } from "@/lib/auth";
import { getHelpManualForRole } from "@/lib/help-manual";

export default async function HelpPage() {
  await requireUser();
  const profile = await getActiveProfileForRoles(["Admin", "Co-Admin", "Member"]);

  if (!profile) redirect("/home");

  const manual = getHelpManualForRole(profile.role);

  return (
    <div className="motion-content-ready mx-auto w-full max-w-6xl">
      <HelpManual manual={manual} />
      <footer className="mt-8 text-center text-sm text-muted-foreground">
        <Link
          href="/terms"
          className="inline-flex min-h-11 items-center rounded-md px-2 underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 md:min-h-0"
        >
          Terms of Service
        </Link>
      </footer>
    </div>
  );
}
