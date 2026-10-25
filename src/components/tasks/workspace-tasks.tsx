"use client";

import { useCallback, useRef, useState, type KeyboardEvent } from "react";
import { HandHelping, ListChecks } from "lucide-react";
import { HelpWantedList } from "@/components/tasks/help-wanted-list";
import { MyTasksList } from "@/components/tasks/my-tasks-list";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { OffsetListPage } from "@/lib/list-paging";
import type { HelpWantedTask } from "@/lib/tasks/backup";
import {
  formatLoadedTaskCount,
  getLoadedMyTasksCount,
  isMyTasksSort,
  isMyTasksStatus,
  type MyTask,
  type MyTasksSort,
  type MyTasksStatus,
} from "@/lib/tasks/my-tasks";
import { cn } from "@/lib/utils";
import { TabPanel } from "@/components/shared/motion";

type WorkspaceTab = "mine" | "help";
type LoadedState = { count: number; hasNextPage: boolean };

const statusItems = [
  { value: "all", label: "All statuses" },
  { value: "To Do", label: "To Do" },
  { value: "In Progress", label: "In Progress" },
  { value: "Completed", label: "Completed" },
];

const sortItems = [
  { value: "deadline", label: "Deadline" },
  { value: "priority", label: "Priority" },
  { value: "event", label: "Event" },
];

export function WorkspaceTasks({
  initialMyTasksPage,
  initialHelpWantedPage,
}: {
  initialMyTasksPage?: OffsetListPage<MyTask>;
  initialHelpWantedPage?: OffsetListPage<HelpWantedTask>;
}) {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("mine");
  const [tabMotionKey, setTabMotionKey] = useState(0);
  const [status, setStatus] = useState<MyTasksStatus>(null);
  const [sort, setSort] = useState<MyTasksSort>("deadline");
  const [myTasksState, setMyTasksState] = useState<LoadedState>(() => ({
    count: getLoadedMyTasksCount(initialMyTasksPage?.items ?? []),
    hasNextPage: initialMyTasksPage?.hasMore ?? false,
  }));
  const [helpWantedState, setHelpWantedState] = useState<LoadedState>(() => ({
    count: initialHelpWantedPage?.items.length ?? 0,
    hasNextPage: initialHelpWantedPage?.hasMore ?? false,
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
    selectTab(nextTab);
    if (nextTab === "mine") myTasksTabRef.current?.focus();
    else helpWantedTabRef.current?.focus();
  }

  function selectTab(nextTab: WorkspaceTab) {
    if (nextTab === activeTab) return;
    setActiveTab(nextTab);
    setTabMotionKey((current) => current + 1);
  }

  return (
    <section
      aria-label="Task workspace"
      className="space-y-3 [&_button]:transition-colors [&_button]:duration-150 motion-reduce:[&_button]:transition-none"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div
          role="tablist"
          aria-label="Task lists"
          className="grid w-full grid-cols-2 gap-1 rounded-xl bg-secondary p-1 sm:inline-grid sm:w-auto"
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
              "flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold outline-none transition-colors duration-150 active:translate-y-px focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none motion-reduce:active:translate-y-0 sm:px-3.5",
              activeTab === "mine"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => selectTab("mine")}
            onKeyDown={(event) => handleTabKeyDown(event, "mine")}
          >
            <ListChecks className="size-4 shrink-0" aria-hidden />
            My Tasks
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-semibold",
                activeTab === "mine"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground",
              )}
            >
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
              "flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold outline-none transition-colors duration-150 active:translate-y-px focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none motion-reduce:active:translate-y-0 sm:px-3.5",
              activeTab === "help"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => selectTab("help")}
            onKeyDown={(event) => handleTabKeyDown(event, "help")}
          >
            <HandHelping className="size-4 shrink-0" aria-hidden />
            Help Wanted
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-semibold",
                activeTab === "help"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {formatLoadedTaskCount(
                helpWantedState.count,
                helpWantedState.hasNextPage,
              )}
            </span>
          </button>
        </div>
        {activeTab === "mine" ? (
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
            <div className="space-y-1">
              <label
                htmlFor="my-tasks-status"
                className="block text-xs font-medium text-muted-foreground"
              >
                Status
              </label>
              <Select
                items={statusItems}
                value={status ?? "all"}
                onValueChange={(value) => {
                  if (value === "all") setStatus(null);
                  else if (isMyTasksStatus(value)) setStatus(value);
                }}
              >
                <SelectTrigger
                  id="my-tasks-status"
                  className="w-full sm:min-w-36"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statusItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label
                htmlFor="my-tasks-sort"
                className="block text-xs font-medium text-muted-foreground"
              >
                Sort
              </label>
              <Select
                items={sortItems}
                value={sort}
                onValueChange={(value) => {
                  if (isMyTasksSort(value)) setSort(value);
                }}
              >
                <SelectTrigger
                  id="my-tasks-sort"
                  className="w-full sm:min-w-32"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sortItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : null}
      </div>

      <TabPanel
        motionKey={activeTab === "mine" ? tabMotionKey : 0}
        id="my-tasks-panel"
        role="tabpanel"
        aria-labelledby="my-tasks-tab"
        hidden={activeTab !== "mine"}
        inert={activeTab !== "mine" ? true : undefined}
        className="space-y-3 focus-visible:outline-none"
      >
        <MyTasksList
          initialPage={initialMyTasksPage}
          active={activeTab === "mine"}
          status={status}
          sort={sort}
          onLoadedStateChange={updateMyTasksState}
        />
      </TabPanel>

      <TabPanel
        motionKey={activeTab === "help" ? tabMotionKey : 0}
        id="help-wanted-panel"
        role="tabpanel"
        aria-labelledby="help-wanted-tab"
        hidden={activeTab !== "help"}
        inert={activeTab !== "help" ? true : undefined}
        className="space-y-3 focus-visible:outline-none"
      >
        <HelpWantedList
          initialPage={initialHelpWantedPage}
          active={activeTab === "help"}
          onLoadedStateChange={updateHelpWantedState}
        />
      </TabPanel>
    </section>
  );
}
