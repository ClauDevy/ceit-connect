import Link from "next/link"

export function LoginTermsLink() {
  return (
    <p className="text-center text-xs text-muted-foreground">
      <Link
        href="/terms"
        className="rounded-sm underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        Terms of Service
      </Link>
    </p>
  )
}
