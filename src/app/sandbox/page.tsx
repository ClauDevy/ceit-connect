import { notFound } from "next/navigation";
import { DrivePreviewDemo } from "@/components/tasks/drive-preview-demo";

export default function SandboxPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <main className="min-h-screen bg-background p-5 text-foreground sm:p-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="font-display text-2xl font-semibold">
            Sandbox — UI Playground
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Mock data only. Links added here stay in this browser session and
            are never saved.
          </p>
        </div>
        <DrivePreviewDemo />
      </div>
    </main>
  );
}
