import Link from "next/link"

const linkClass =
  "rounded-sm underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"

export function LoginTermsLink() {
  return (
    <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center text-xs text-muted-foreground">
      <Link href="/terms" className={linkClass}>
        Terms of Service
      </Link>
      <span aria-hidden>·</span>
      <Link href="/privacy" className={linkClass}>
        Privacy Policy
      </Link>
    </p>
  )
}
