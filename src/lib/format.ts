export function getInitials(name: string | null | undefined, max = 2): string {
  return (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, max)
    .toUpperCase();
}
