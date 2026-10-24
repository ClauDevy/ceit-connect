import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { SettingsSection } from "@/components/settings/settings-section";
import { SetPasswordForm } from "@/components/settings/set-password-form";
import { AvatarUploader } from "@/components/settings/avatar-uploader";
import { FullNameForm } from "@/components/settings/full-name-form";

export default async function SettingsPage() {
  const supabase = await createClient();
  const user = await requireUser();

  const { data: profile } = await supabase
    .from("users")
    .select("full_name, password_set, avatar_url")
    .eq("id", user.id)
    .single();

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Your profile photo and sign-in options."
      />

      <div className="grid max-w-xl gap-5">
        <SettingsSection
          title="Profile"
          description="Update the name shown across the council workspace."
        >
          <FullNameForm currentName={profile?.full_name ?? ""} />
        </SettingsSection>

        <SettingsSection
          title="Profile photo"
          description="Shown next to your name across the council workspace."
        >
          <AvatarUploader
            userId={user.id}
            userName={profile?.full_name ?? ""}
            currentAvatarUrl={profile?.avatar_url ?? null}
          />
        </SettingsSection>

        <SettingsSection
          title="Password"
          description={
            profile?.password_set
              ? "Update your password."
              : "Set a password to enable email and password sign-in, and Google sign-in."
          }
        >
          <SetPasswordForm hasPassword={!!profile?.password_set} />
        </SettingsSection>
      </div>
    </div>
  );
}
