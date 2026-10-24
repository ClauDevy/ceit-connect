import Link from "next/link";
import { cn } from "@/lib/utils";

const stretchedLinkClassName =
  "absolute inset-0 z-10 rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

export function StretchedLink({
  href,
  label,
  className,
}: {
  href: string;
  label: string;
  className?: string;
}) {
  return (
    <Link href={href} aria-label={label} className={cn(stretchedLinkClassName, className)}>
      <span className="sr-only">{label}</span>
    </Link>
  );
}

export function StretchedExternalLink({
  href,
  label,
  className,
}: {
  href: string;
  label: string;
  className?: string;
}) {
  return (
    <a
      href={href}
      aria-label={label}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(stretchedLinkClassName, className)}
    >
      <span className="sr-only">{label}</span>
    </a>
  );
}
