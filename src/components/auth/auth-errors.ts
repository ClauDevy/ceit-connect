// Keyed by the `?error=` value other routes redirect to /login with.
export const AUTH_ERROR_MESSAGES: Record<string, string> = {
  not_invited: "That Google account isn't recognized. Ask an Admin to invite you first.",
  set_password_first:
    "Please sign in with your email link first, then set a password in Settings before using Google sign-in.",
  auth: "Something went wrong. Please try again.",
  deactivated:
    "This account has been deactivated. Contact an Admin if you believe this is a mistake.",
  no_profile:
    "Your account isn't fully set up yet. Ask an Admin to check your invite.",
}
