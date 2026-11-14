import { Archive, Check, FileText, LoaderCircle, RotateCcw, Search } from "lucide-react";
import { SectionEnter, MotionPresence, TabPanel } from "@/components/shared/motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import { TigerLogo } from "@/components/ui/tiger-logo";
import { preventSearchFormSubmission } from "@/lib/search";
import type {
  ArchivedEventTemplate,
  PendingTemplateImport,
  TemplateImportSummary,
} from "@/components/events/event-form-types";

type EventFormTemplatePickerProps = {
  templateMode: "scratch" | "archive";
  templateMotionKey: number;
  templateSearch: string;
  templateStatus: "idle" | "loading";
  templateError: string;
  templateSummary: TemplateImportSummary | null;
  archivedTemplates: ArchivedEventTemplate[];
  filteredArchivedTemplates: ArchivedEventTemplate[];
  importedStartDateChanged: boolean;
  startDate: string;
  onSelectMode: (mode: "scratch" | "archive") => void;
  onSearchChange: (value: string) => void;
  onRequestImport: (
    template: ArchivedEventTemplate,
    reason?: PendingTemplateImport["reason"],
  ) => void;
};

export function EventFormTemplatePicker({
  templateMode,
  templateMotionKey,
  templateSearch,
  templateStatus,
  templateError,
  templateSummary,
  archivedTemplates,
  filteredArchivedTemplates,
  importedStartDateChanged,
  startDate,
  onSelectMode,
  onSearchChange,
  onRequestImport,
}: EventFormTemplatePickerProps) {
  return (
    <SectionEnter>
      <Card className="mb-6 overflow-hidden">
        <CardHeader className="border-b bg-gradient-to-r from-primary/10 via-muted/30 to-card pb-4 sm:pb-4">
          <CardTitle>Choose a starting point</CardTitle>
          <p className="text-sm text-muted-foreground">
            Build a fresh task list or copy the structure of an Archived event.
          </p>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              aria-pressed={templateMode === "scratch"}
              onClick={() => onSelectMode("scratch")}
              className={`relative flex min-h-20 items-start gap-3 rounded-2xl border-2 p-4 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 ${
                templateMode === "scratch"
                  ? "border-primary bg-primary/10"
                  : "border-border bg-card hover:border-primary/50 hover:bg-muted/30"
              }`}
            >
              {templateMode === "scratch" ? (
                <span className="absolute top-3 right-3 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check aria-hidden className="size-3" />
                </span>
              ) : null}
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <FileText aria-hidden className="size-5" />
              </span>
              <span>
                <span className="block font-semibold">Start from Scratch</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Create phases and tasks from a blank slate.
                </span>
              </span>
            </button>
            <button
              type="button"
              aria-pressed={templateMode === "archive"}
              onClick={() => onSelectMode("archive")}
              className={`relative flex min-h-20 items-start gap-3 rounded-2xl border-2 p-4 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 ${
                templateMode === "archive"
                  ? "border-primary bg-primary/10"
                  : "border-border bg-card hover:border-primary/50 hover:bg-muted/30"
              }`}
            >
              {templateMode === "archive" ? (
                <span className="absolute top-3 right-3 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check aria-hidden className="size-3" />
                </span>
              ) : null}
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Archive aria-hidden className="size-5" />
              </span>
              <span>
                <span className="block font-semibold">Start from Archive Template</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Copy past tasks and shift their dates automatically.
                </span>
              </span>
            </button>
          </div>

          {templateMode === "archive" && (
            <TabPanel
              motionKey={templateMotionKey}
              className="grid gap-3 rounded-2xl border bg-muted/30 p-4"
            >
              <div>
                <p className="text-sm font-semibold">Choose an Archived event</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Assignees are cleared, every copied task starts as To Do, and
                  confidential tasks are skipped.
                </p>
              </div>

              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label="Search Archived events"
                  type="search"
                  value={templateSearch}
                  onChange={(event) => onSearchChange(event.target.value)}
                  onKeyDown={preventSearchFormSubmission}
                  placeholder="Search past events…"
                  className="pl-9"
                />
              </div>

              <div className="grid max-h-64 gap-2 overflow-y-auto">
                {filteredArchivedTemplates.map((template) => (
                  <div
                    key={template.id}
                    className="flex items-center gap-3 rounded-xl border bg-card p-3"
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-semibold text-muted-foreground">
                      {template.startDate.slice(0, 4)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">
                        {template.name}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        Started {template.startDate}
                      </span>
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={templateStatus === "loading"}
                      onClick={() => onRequestImport(template)}
                    >
                      {templateStatus === "loading" ? (
                        <>
                          <LoaderCircle className="motion-safe:animate-spin" aria-hidden />
                          Importing…
                        </>
                      ) : (
                        "Use"
                      )}
                    </Button>
                  </div>
                ))}

                {archivedTemplates.length === 0 && (
                  <div className="grid justify-items-center gap-2 rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">
                    <TigerLogo size={36} className="motion-empty-breathe shrink-0 opacity-70 grayscale" />
                    <p>No Archived events are available yet.</p>
                  </div>
                )}
                {archivedTemplates.length > 0 &&
                  filteredArchivedTemplates.length === 0 && (
                    <p className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">
                      No Archived events match your search.
                    </p>
                  )}
              </div>

              {templateError && <InlineAlert>{templateError}</InlineAlert>}
            </TabPanel>
          )}

          <MotionPresence open={templateSummary !== null}>
            {templateSummary ? <InlineAlert variant="info">
              <div className="grid gap-2">
                <p>
                  {templateSummary.applied
                    ? `Imported ${templateSummary.importedTaskCount} task${templateSummary.importedTaskCount === 1 ? "" : "s"} from “${templateSummary.template.name}” into the Backlog as To Do.`
                    : `“${templateSummary.template.name}” has no importable tasks. Non-template tasks were left unchanged.`}
                </p>
                {templateSummary.skippedConfidentialCount > 0 && (
                  <p className="font-medium">
                    {templateSummary.skippedConfidentialCount} confidential task
                    {templateSummary.skippedConfidentialCount === 1 ? " was" : "s were"}{" "}
                    not imported.
                  </p>
                )}
                {importedStartDateChanged && (
                  <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p>
                      These dates were shifted for a{" "}
                      {templateSummary.importedStartDate}
                      start. Re-import to use the new {startDate || "blank"}
                      start date.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={templateStatus === "loading"}
                      onClick={() =>
                        onRequestImport(templateSummary.template, "reimport")
                      }
                    >
                      <RotateCcw />
                      Re-import with new start date
                    </Button>
                  </div>
                )}
              </div>
            </InlineAlert> : null}
          </MotionPresence>
        </CardContent>
      </Card>
    </SectionEnter>
  );
}
