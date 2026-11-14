import { redirect } from "next/navigation";
import { HelpManual } from "@/components/help/help-manual";
import { PageHeader } from "@/components/shared/page-header";
import { getActiveProfileForRoles, requireUser } from "@/lib/auth";
import { getHelpManualForRole } from "@/lib/help-manual";

export default async function HelpPage() {
  await requireUser();
  const profile = await getActiveProfileForRoles(["Admin", "Co-Admin", "Member"]);

  if (!profile) redirect("/home");

  const manual = getHelpManualForRole(profile.role);

  return (
    <div className="motion-content-ready mx-auto w-full max-w-6xl">
      <PageHeader
        title="Help & user manual"
        description="A practical guide to CEIT Connect, filtered for your role."
      />
      <HelpManual manual={manual} />
    </div>
  );
}
