import { BellRing, Download, Image as ImageIcon, KeyRound, UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { SettingsSection } from "@/components/settings/settings-section";
import { SetPasswordForm } from "@/components/settings/set-password-form";
import { AvatarUploader } from "@/components/settings/avatar-uploader";
import { FullNameForm } from "@/components/settings/full-name-form";
import { InlineAlert } from "@/components/ui/inline-alert";
import { InstallAppHelp } from "@/components/settings/install-app-help";
import { PushNotificationsControl } from "@/components/settings/push-notifications-control";

export default async function SettingsPage() {
  const supabase = await createClient();
  const user = await requireUser();

  const { data: profile } = await supabase
    .from("users")
    .select("full_name, password_set, avatar_url")
    .eq("id", user.id)
    .single();

  return (
    <div className="motion-content-ready mx-auto w-full max-w-4xl">
      <PageHeader
        title="Settings"
      />

      {!profile?.password_set ? (
        <InlineAlert variant="warning" className="mb-5 flex items-start gap-3">
          <KeyRound className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <b>One step left:</b> set a backup password below so you can still sign
            in if Google or email links are unavailable. The orange dot on the
            Settings tab goes away once it&apos;s set.
          </span>
        </InlineAlert>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <SettingsSection
          motionIndex={0}
          title="Profile"
          description="Update the name shown across the council workspace."
          icon={<UserRound aria-hidden />}
        >
          <FullNameForm currentName={profile?.full_name ?? ""} />
        </SettingsSection>

        <SettingsSection
          motionIndex={1}
          title="Profile photo"
          description="Shown next to your name across the council workspace."
          icon={<ImageIcon aria-hidden />}
        >
          <AvatarUploader
            userId={user.id}
            userName={profile?.full_name ?? ""}
            currentAvatarUrl={profile?.avatar_url ?? null}
          />
        </SettingsSection>

        <SettingsSection
          motionIndex={2}
          title="Password"
          icon={<KeyRound aria-hidden />}
          attention={!profile?.password_set}
          description={
            profile?.password_set
              ? "Update your password."
              : "Set a backup password to enable email and password sign-in."
          }
        >
          <SetPasswordForm hasPassword={!!profile?.password_set} />
        </SettingsSection>

        <SettingsSection
          motionIndex={3}
          title="Notifications on this device"
          description="Choose whether this browser receives generic task alerts."
          icon={<BellRing aria-hidden />}
        >
          <PushNotificationsControl userId={user.id} />
        </SettingsSection>

        <SettingsSection
          motionIndex={4}
          title="Install the app"
          description="Keep CEIT Connect within easy reach on your phone."
          icon={<Download aria-hidden />}
        >
          <InstallAppHelp />
        </SettingsSection>
      </div>
    </div>
  );
}
