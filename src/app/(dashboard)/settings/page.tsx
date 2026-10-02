import { createClient } from "@/lib/supabase/server";
import { SetPasswordForm } from "@/components/settings/set-password-form";
import { AvatarUploader } from "@/components/settings/avatar-uploader";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("users")
    .select("password_set, avatar_url")
    .eq("id", user!.id)
    .single();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <div className="max-w-sm rounded-2xl border bg-card p-6">
        <h2 className="mb-4 text-sm font-semibold">Profile Photo</h2>
        <AvatarUploader
          userId={user!.id}
          currentAvatarUrl={profile?.avatar_url ?? null}
        />
      </div>

      <div className="max-w-sm rounded-2xl border bg-card p-6">
        <h2 className="mb-1 text-sm font-semibold">Password</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          {profile?.password_set
            ? "Update your password."
            : "Set a password to enable email+password and Google sign-in."}
        </p>
        <SetPasswordForm hasPassword={!!profile?.password_set} />
      </div>
    </div>
  );
}