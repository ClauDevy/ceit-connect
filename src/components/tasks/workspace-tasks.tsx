"use client";

import { useCallback, useRef, useState, type KeyboardEvent } from "react";
import { HelpWantedList } from "@/components/tasks/help-wanted-list";
import { MyTasksList } from "@/components/tasks/my-tasks-list";
import {
  HELP_WANTED_PAGE_SIZE,
  type HelpWantedTask,
} from "@/lib/tasks/backup";
import {
  MY_TASKS_PAGE_SIZE,
  formatLoadedTaskCount,
  getLoadedMyTasksCount,
  type MyTask,
} from "@/lib/tasks/my-tasks";
import { cn } from "@/lib/utils";

type WorkspaceTab = "mine" | "help";
type LoadedState = { count: number; hasNextPage: boolean };

export function WorkspaceTasks({
  initialMyTasks,
  initialHelpWantedTasks,
}: {
  initialMyTasks?: MyTask[];
  initialHelpWantedTasks?: HelpWantedTask[];
}) {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("mine");
  const [myTasksState, setMyTasksState] = useState<LoadedState>(() => ({
    count: getLoadedMyTasksCount(initialMyTasks ?? []),
    hasNextPage: initialMyTasks?.length === MY_TASKS_PAGE_SIZE,
  }));
  const [helpWantedState, setHelpWantedState] = useState<LoadedState>(() => ({
    count: initialHelpWantedTasks?.length ?? 0,
    hasNextPage: initialHelpWantedTasks?.length === HELP_WANTED_PAGE_SIZE,
  }));
  const myTasksTabRef = useRef<HTMLButtonElement>(null);
  const helpWantedTabRef = useRef<HTMLButtonElement>(null);

  const updateMyTasksState = useCallback((state: LoadedState) => {
    setMyTasksState(state);
  }, []);
  const updateHelpWantedState = useCallback((state: LoadedState) => {
    setHelpWantedState(state);
  }, []);

  function handleTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    tab: WorkspaceTab,
  ) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const nextTab = tab === "mine" ? "help" : "mine";
    setActiveTab(nextTab);
    if (nextTab === "mine") myTasksTabRef.current?.focus();
    else helpWantedTabRef.current?.focus();
  }

  return (
    <section aria-label="Task workspace" className="space-y-5">
      <div
        role="tablist"
        aria-label="Task lists"
        className="inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-xl bg-secondary p-1"
      >
        <button
          ref={myTasksTabRef}
          id="my-tasks-tab"
          type="button"
          role="tab"
          aria-selected={activeTab === "mine"}
          aria-controls="my-tasks-panel"
          tabIndex={activeTab === "mine" ? 0 : -1}
          className={cn(
            "flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
            activeTab === "mine"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => setActiveTab("mine")}
          onKeyDown={(event) => handleTabKeyDown(event, "mine")}
        >
          My Tasks
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {formatLoadedTaskCount(
              myTasksState.count,
              myTasksState.hasNextPage,
            )}
          </span>
        </button>
        <button
          ref={helpWantedTabRef}
          id="help-wanted-tab"
          type="button"
          role="tab"
          aria-selected={activeTab === "help"}
          aria-controls="help-wanted-panel"
          tabIndex={activeTab === "help" ? 0 : -1}
          className={cn(
            "flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
            activeTab === "help"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => setActiveTab("help")}
          onKeyDown={(event) => handleTabKeyDown(event, "help")}
        >
          Help Wanted
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {formatLoadedTaskCount(
              helpWantedState.count,
              helpWantedState.hasNextPage,
            )}
          </span>
        </button>
      </div>

      <div
        id="my-tasks-panel"
        role="tabpanel"
        aria-labelledby="my-tasks-tab"
        hidden={activeTab !== "mine"}
        className="space-y-4"
      >
        <div>
          <h2 className="font-display text-xl font-semibold">My Tasks</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Your primary and assist assignments from active events.
          </p>
        </div>
        <MyTasksList
          initialTasks={initialMyTasks}
          active={activeTab === "mine"}
          onLoadedStateChange={updateMyTasksState}
        />
      </div>

      <div
        id="help-wanted-panel"
        role="tabpanel"
        aria-labelledby="help-wanted-tab"
        hidden={activeTab !== "help"}
        className="space-y-4"
      >
        <div>
          <h2 className="font-display text-xl font-semibold">Help Wanted</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Volunteer for tasks you can fully access from any committee.
          </p>
        </div>
        <HelpWantedList
          initialTasks={initialHelpWantedTasks}
          active={activeTab === "help"}
          onLoadedStateChange={updateHelpWantedState}
        />
      </div>
    </section>
  );
}
