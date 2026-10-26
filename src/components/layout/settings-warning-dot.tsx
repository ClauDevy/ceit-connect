export function SettingsWarningDot({ className = "" }: { className?: string }) {
  return (
    <span
      aria-label="Password not set"
      title="Password not set"
      className={`inline-flex size-2.5 shrink-0 rounded-full bg-primary ring-2 ring-background ${className}`}
    />
  );
}
