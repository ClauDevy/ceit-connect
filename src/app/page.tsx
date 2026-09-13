export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-8 text-foreground">
      <h1 className="text-3xl font-bold tracking-tight">CEIT Connect Theme Check</h1>
      <p className="text-muted-foreground">Slate background with Council Orange accents.</p>
      <div className="flex gap-4">
        <button className="rounded-lg bg-primary px-5 py-2.5 font-medium text-primary-foreground shadow transition hover:opacity-90">
          Council Primary Button
        </button>
        <button className="rounded-lg border border-border bg-card px-5 py-2.5 font-medium text-foreground shadow-sm">
          Slate Card Action
        </button>
      </div>
    </main>
  );
}