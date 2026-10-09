import { AuthShell } from "@/components/auth/auth-shell";
import { AUTH_ERROR_MESSAGES } from "@/components/auth/auth-errors";
import { SignInPanel } from "@/components/auth/sign-in-panel";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { error } = await searchParams;
  const initialError =
    typeof error === "string" &&
    Object.prototype.hasOwnProperty.call(AUTH_ERROR_MESSAGES, error)
      ? AUTH_ERROR_MESSAGES[error]
      : undefined;

  return (
    <AuthShell>
      <SignInPanel initialError={initialError} />
    </AuthShell>
  );
}
