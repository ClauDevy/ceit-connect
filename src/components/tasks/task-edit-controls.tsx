"use client";

import { useMemo, useState } from "react";
import { Check, Link2, LockKeyhole, Search } from "lucide-react";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import { preventSearchFormSubmission } from "@/lib/search";
import {
  confidentialityViewerIds,
  MAX_TASK_ALLOWED_VIEWERS,
  type TaskEditControlData,
  type TaskEditViewer,
} from "@/lib/tasks/edit-controls";

type TaskEditControlsProps = {
  controls: TaskEditControlData;
  onSaveDependency: (dependencyId: string | null) => Promise<void>;
  onSaveConfidentiality: (
    isConfidential: boolean,
    viewerIds: string[],
  ) => Promise<void>;
};

function viewerName(viewer: TaskEditViewer) {
  return viewer.full_name?.trim() || "Former member";
}

export function TaskEditControls({
  controls,
  onSaveDependency,
  onSaveConfidentiality,
}: TaskEditControlsProps) {
  const [dependencyOpen, setDependencyOpen] = useState(false);
  const [dependencySearch, setDependencySearch] = useState("");
  const [selectedDependency, setSelectedDependency] = useState<string | null>(
    controls.depends_on_task_id,
  );
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerSearch, setViewerSearch] = useState("");
  const [selectedViewerIds, setSelectedViewerIds] = useState<string[]>(
    controls.allowed_viewers.map((viewer) => viewer.id),
  );
  const [savingDependency, setSavingDependency] = useState(false);
  const [savingConfidentiality, setSavingConfidentiality] = useState(false);
  const [dependencyError, setDependencyError] = useState<string | null>(null);
  const [confidentialityError, setConfidentialityError] = useState<
    string | null
  >(null);

  const currentDependency = controls.dependency_options.find(
    (option) => option.id === controls.depends_on_task_id,
  );
  const filteredDependencies = controls.dependency_options.filter((option) =>
    `${option.label} ${option.status}`
      .toLocaleLowerCase()
      .includes(dependencySearch.trim().toLocaleLowerCase()),
  );

  const selectableViewerIds = useMemo(
    () => new Set(controls.viewer_options.map((viewer) => viewer.id)),
    [controls.viewer_options],
  );
  const viewerChoices = useMemo(() => {
    const choices = new Map<string, TaskEditViewer>();
    for (const viewer of controls.allowed_viewers)
      choices.set(viewer.id, viewer);
    for (const viewer of controls.viewer_options)
      choices.set(viewer.id, viewer);
    return [...choices.values()].filter((viewer) =>
      viewerName(viewer)
        .toLocaleLowerCase()
        .includes(viewerSearch.trim().toLocaleLowerCase()),
    );
  }, [controls.allowed_viewers, controls.viewer_options, viewerSearch]);

  async function saveDependency() {
    setSavingDependency(true);
    setDependencyError(null);
    try {
      await onSaveDependency(selectedDependency);
      setDependencyOpen(false);
    } catch (error) {
      setDependencyError(
        error instanceof Error
          ? error.message
          : "The dependency could not be saved.",
      );
    } finally {
      setSavingDependency(false);
    }
  }

  async function setConfidential(isConfidential: boolean) {
    setSavingConfidentiality(true);
    setConfidentialityError(null);
    try {
      await onSaveConfidentiality(
        isConfidential,
        confidentialityViewerIds(
          isConfidential,
          controls.allowed_viewers.map((viewer) => viewer.id),
        ),
      );
    } catch (error) {
      setConfidentialityError(
        error instanceof Error
          ? error.message
          : "The confidentiality settings could not be saved.",
      );
    } finally {
      setSavingConfidentiality(false);
    }
  }

  async function saveViewers() {
    if (selectedViewerIds.length > MAX_TASK_ALLOWED_VIEWERS) {
      setConfidentialityError(
        `Choose no more than ${MAX_TASK_ALLOWED_VIEWERS} additional viewers.`,
      );
      return;
    }

    setSavingConfidentiality(true);
    setConfidentialityError(null);
    try {
      await onSaveConfidentiality(true, selectedViewerIds);
      setViewerOpen(false);
    } catch (error) {
      setConfidentialityError(
        error instanceof Error
          ? error.message
          : "The confidentiality settings could not be saved.",
      );
    } finally {
      setSavingConfidentiality(false);
    }
  }

  function openDependencyDialog() {
    setSelectedDependency(controls.depends_on_task_id);
    setDependencySearch("");
    setDependencyError(null);
    setDependencyOpen(true);
  }

  function openViewerDialog() {
    setSelectedViewerIds(controls.allowed_viewers.map((viewer) => viewer.id));
    setViewerSearch("");
    setConfidentialityError(null);
    setViewerOpen(true);
  }

  return (
    <>
      {controls.can_set_dependency ? (
        <Card>
          <CardHeader className="px-4 pt-4 pb-0 sm:px-5 sm:pt-5">
            <CardTitle className="flex items-center gap-2 text-xs font-bold tracking-wide text-muted-foreground uppercase">
              <Link2 className="size-4" aria-hidden /> Dependency
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 px-4 pt-3 pb-4 sm:px-5 sm:pb-5">
            <div>
              <p className="text-sm font-medium">
                {controls.depends_on_task_id
                  ? (currentDependency?.label ?? "Unavailable prerequisite")
                  : "No prerequisite"}
              </p>
              {currentDependency ? (
                <p className="text-xs text-muted-foreground">
                  {currentDependency.status}
                </p>
              ) : null}
            </div>
            {dependencyError ? (
              <InlineAlert>{dependencyError}</InlineAlert>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={openDependencyDialog}
              disabled={savingDependency}
            >
              Manage dependency
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {controls.can_set_confidentiality && controls.is_confidential !== null ? (
        <Card>
          <CardHeader className="px-4 pt-4 pb-0 sm:px-5 sm:pt-5">
            <CardTitle className="flex items-center gap-2 text-xs font-bold tracking-wide text-muted-foreground uppercase">
              <LockKeyhole className="size-4" aria-hidden /> Confidential
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 px-4 pt-3 pb-4 sm:px-5 sm:pb-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <label
                  htmlFor="task-confidential-toggle"
                  className="text-sm font-semibold"
                >
                  Mask this task
                </label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Only leadership, assignees, and selected viewers get full
                  access.
                </p>
              </div>
              <input
                id="task-confidential-toggle"
                type="checkbox"
                checked={controls.is_confidential}
                disabled={savingConfidentiality}
                onChange={(event) => void setConfidential(event.target.checked)}
                className="mt-1 size-4 shrink-0 accent-primary"
              />
            </div>

            {controls.is_confidential ? (
              <div className="space-y-3 border-t pt-4">
                <div>
                  <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
                    Additional viewers
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Assignees always have access.
                  </p>
                </div>
                {controls.allowed_viewers.length > 0 ? (
                  <div className="space-y-2">
                    {controls.allowed_viewers.map((viewer) => (
                      <div key={viewer.id} className="flex items-center gap-2">
                        <UserAvatar
                          name={viewerName(viewer)}
                          src={viewer.avatar_url}
                          size="sm"
                        />
                        <span className="min-w-0 truncate text-sm font-medium">
                          {viewerName(viewer)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No additional viewers.
                  </p>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={openViewerDialog}
                  disabled={savingConfidentiality}
                >
                  Manage access
                </Button>
              </div>
            ) : null}
            {confidentialityError ? (
              <InlineAlert>{confidentialityError}</InlineAlert>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Dialog open={dependencyOpen} onOpenChange={setDependencyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Task dependency</DialogTitle>
            <DialogDescription>
              Choose one prerequisite from this event. Hidden titles are never
              revealed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label htmlFor="dependency-search" className="sr-only">
              Search prerequisite tasks
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                id="dependency-search"
                type="search"
                value={dependencySearch}
                onChange={(event) => setDependencySearch(event.target.value)}
                onKeyDown={preventSearchFormSubmission}
                placeholder="Search tasks"
                className="pl-9"
              />
            </div>
            <div className="max-h-64 space-y-1 overflow-y-auto">
              <label
                htmlFor="dependency-none"
                className="flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 hover:bg-muted"
              >
                <input
                  id="dependency-none"
                  type="radio"
                  name="task-dependency"
                  checked={selectedDependency === null}
                  onChange={() => setSelectedDependency(null)}
                  className="size-4 accent-primary"
                />
                <span className="text-sm font-medium">No prerequisite</span>
              </label>
              {filteredDependencies.map((option) => {
                const inputId = `dependency-${option.id}`;
                return (
                  <label
                    key={option.id}
                    htmlFor={inputId}
                    className="flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 hover:bg-muted"
                  >
                    <input
                      id={inputId}
                      type="radio"
                      name="task-dependency"
                      checked={selectedDependency === option.id}
                      onChange={() => setSelectedDependency(option.id)}
                      className="size-4 accent-primary"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {option.label}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {option.status}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
            {dependencyError ? (
              <InlineAlert>{dependencyError}</InlineAlert>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDependencyOpen(false)}
              disabled={savingDependency}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void saveDependency()}
              disabled={savingDependency}
            >
              {savingDependency ? "Saving…" : "Save dependency"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={viewerOpen} onOpenChange={setViewerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confidential access</DialogTitle>
            <DialogDescription>
              Assignees always have access. Choose up to 50 additional viewers.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label htmlFor="viewer-search" className="sr-only">
              Search viewers
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                id="viewer-search"
                type="search"
                value={viewerSearch}
                onChange={(event) => setViewerSearch(event.target.value)}
                onKeyDown={preventSearchFormSubmission}
                placeholder="Search people"
                className="pl-9"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {selectedViewerIds.length} of {MAX_TASK_ALLOWED_VIEWERS} selected
            </p>
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {viewerChoices.map((viewer) => {
                const inputId = `viewer-${viewer.id}`;
                const isActiveOption = selectableViewerIds.has(viewer.id);
                const isSelected = selectedViewerIds.includes(viewer.id);
                return (
                  <label
                    key={viewer.id}
                    htmlFor={inputId}
                    className="flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 hover:bg-muted"
                  >
                    <input
                      id={inputId}
                      type="checkbox"
                      checked={isSelected}
                      onChange={(event) => {
                        setSelectedViewerIds((current) =>
                          event.target.checked
                            ? [...new Set([...current, viewer.id])]
                            : current.filter((id) => id !== viewer.id),
                        );
                      }}
                      className="size-4 accent-primary"
                    />
                    <UserAvatar
                      name={viewerName(viewer)}
                      src={viewer.avatar_url}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {viewerName(viewer)}
                    </span>
                    {isSelected ? (
                      <Check className="size-4 text-primary" aria-hidden />
                    ) : null}
                    {!isActiveOption ? (
                      <span className="text-xs text-muted-foreground">
                        Inactive
                      </span>
                    ) : null}
                  </label>
                );
              })}
            </div>
            {confidentialityError ? (
              <InlineAlert>{confidentialityError}</InlineAlert>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setViewerOpen(false)}
              disabled={savingConfidentiality}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void saveViewers()}
              disabled={
                savingConfidentiality ||
                selectedViewerIds.length > MAX_TASK_ALLOWED_VIEWERS
              }
            >
              {savingConfidentiality ? "Saving…" : "Save access"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
