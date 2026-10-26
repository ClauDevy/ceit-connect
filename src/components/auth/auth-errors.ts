// Keyed by the `?error=` value other routes redirect to /login with.
export const AUTH_ERROR_MESSAGES: Record<string, string> = {
  not_invited: "Something went wrong. Please try again.",
  set_password_first: "Something went wrong. Please try again.",
  auth: "Something went wrong. Please try again.",
  deactivated:
    "This account has been deactivated. Contact an Admin if you believe this is a mistake.",
  no_profile:
    "Your account isn't fully set up yet. Ask an Admin to check your invite.",
}
