// Small static credit under the sign-in form. Normal flow (never fixed), so it can
// never cover a control. The team logo swaps with the theme through CSS, so only the
// active file is downloaded and there is no flash.
export function LoginFooter() {
  return (
    <footer className="flex flex-col items-center gap-1 px-6 pt-1 pb-[calc(0.5rem+env(safe-area-inset-bottom))] md:pt-2 md:pb-[calc(1rem+env(safe-area-inset-bottom))] text-center text-[11px] leading-snug text-muted-foreground">
      <p className="flex items-center gap-2">
        <span role="img" aria-label="eduCache.on logo" className="brand-team-logo" />
        <span>Built by eduCache.on</span>
      </p>
      <p className="max-w-sm text-balance">
        © 2026 CEIT Student Council, Cavite State University. All rights reserved.
      </p>
    </footer>
  )
}
