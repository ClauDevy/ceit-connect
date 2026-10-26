export function parseAllowedEmailDomains(raw: string | undefined) {
  return (raw ?? "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
}

export function getNormalizedEmailDomain(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const separator = normalizedEmail.lastIndexOf("@");

  if (
    separator <= 0 ||
    separator !== normalizedEmail.indexOf("@") ||
    separator === normalizedEmail.length - 1
  ) {
    return null;
  }

  return normalizedEmail.slice(separator + 1);
}
