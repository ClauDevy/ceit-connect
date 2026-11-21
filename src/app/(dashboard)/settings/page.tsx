import Link from "next/link";
import { BellRing, BookOpen, Download, Image as ImageIcon, KeyRound, LogOut, Mail, UserRound } from "lucide-react";
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
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { PushAwareSignOutForm } from "@/components/layout/push-aware-sign-out-form";
import { ImportantEmailControl } from "@/components/settings/important-email-control";

export default async function SettingsPage() {
  const supabase = await createClient();
  const user = await requireUser();

  const { data: profile } = await supabase
    .from("users")
    .select("full_name, password_set, avatar_url")
    .eq("id", user.id)
    .single();
  const emailPreference = await supabase.rpc(
    "get_important_email_updates_enabled",
  );
  const emailPreferenceAvailable =
    !emailPreference.error && typeof emailPreference.data === "boolean";

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

      {/* One column on phones. From lg, two balanced columns that flow top to bottom, so cards of
          different heights never leave empty gaps. Source order is the phone order. */}
      <div className="grid gap-5 lg:block lg:columns-2 lg:gap-x-5 lg:[&>*]:mb-5 lg:[&>*]:break-inside-avoid">
        <SettingsSection
          motionIndex={0}
          title="Help & user manual"
          description="Learn the current task, event, notification, and role rules."
          icon={<BookOpen aria-hidden />}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Link href="/help" className={buttonVariants({ variant: "outline", className: "w-full sm:col-span-2" })}>
              Open user manual
            </Link>
            <Link href="/terms" className={buttonVariants({ variant: "outline", className: "w-full" })}>
              Terms of Service
            </Link>
            <Link href="/privacy" className={buttonVariants({ variant: "outline", className: "w-full" })}>
              Privacy Policy
            </Link>
          </div>
        </SettingsSection>

        <SettingsSection
          motionIndex={1}
          title="Profile"
          description="Update the name shown across the council workspace."
          icon={<UserRound aria-hidden />}
        >
          <FullNameForm currentName={profile?.full_name ?? ""} />
        </SettingsSection>

        <SettingsSection
          motionIndex={2}
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
          motionIndex={3}
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
          motionIndex={4}
          title="Notifications on this device"
          description="Choose whether this browser receives generic task alerts."
          icon={<BellRing aria-hidden />}
        >
          <PushNotificationsControl userId={user.id} />
        </SettingsSection>

        <SettingsSection
          motionIndex={5}
          title="Important emails"
          description="Choose whether important task updates are sent to your confirmed account email."
          icon={<Mail aria-hidden />}
        >
          <ImportantEmailControl
            available={emailPreferenceAvailable}
            initialEnabled={emailPreferenceAvailable ? emailPreference.data : true}
          />
        </SettingsSection>

        <SettingsSection
          motionIndex={6}
          title="Install the app"
          description="Keep CEIT Connect within easy reach on your phone."
          icon={<Download aria-hidden />}
        >
          <InstallAppHelp />
        </SettingsSection>

        <SettingsSection
          motionIndex={7}
          title="Sign out"
          description="End your CEIT Connect session on this device."
          icon={<LogOut aria-hidden />}
        >
          <PushAwareSignOutForm userId={user.id}>
            <Button type="submit" variant="outline" className="w-full sm:w-auto">
              <LogOut aria-hidden />
              Sign out
            </Button>
          </PushAwareSignOutForm>
        </SettingsSection>
      </div>
    </div>
  );
}
