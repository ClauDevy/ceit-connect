export function SettingsWarningDot({ className = "" }: { className?: string }) {
  return (
    <>
      <span className="sr-only"> Password not set</span>
      <span
        aria-hidden="true"
        className={`inline-flex size-2.5 shrink-0 rounded-full bg-primary ring-2 ring-background ${className}`}
      />
    </>
  );
}
