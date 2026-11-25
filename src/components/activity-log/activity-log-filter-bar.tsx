"use client";

import { useRef } from "react";
import { Pencil, Plus, RefreshCw, Search, SlidersHorizontal, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ACTIVITY_ACTION_LABELS,
  ACTIVITY_SORT_LABELS,
  type ActivityFilters,
} from "@/lib/activity-log";
import { ResponsiveCollapse } from "@/components/shared/motion";
import { cn } from "@/lib/utils";

type Committee = { id: string; name: string };

type Props = {
  filters: ActivityFilters;
  searchInput: string;
  committees: Committee[];
  committeeLabels: Record<string, string>;
  filtersOpen: boolean;
  activeFilterCount: number;
  showClearFilters: boolean;
  refreshing: boolean;
  navigating: boolean;
  onSearchChange: (value: string) => void;
  onFilterChange: (patch: Partial<ActivityFilters>) => void;
  onToggleFilters: () => void;
  onClearFilters: () => void;
  onRefresh: () => void;
};

const quickActions = [
  { value: null, label: "All", icon: null },
  { value: "INSERT", label: ACTIVITY_ACTION_LABELS.INSERT, icon: Plus },
  { value: "UPDATE", label: ACTIVITY_ACTION_LABELS.UPDATE, icon: Pencil },
  { value: "DELETE", label: ACTIVITY_ACTION_LABELS.DELETE, icon: Trash2 },
] as const;

function FieldLabel({ children, htmlFor }: { children: string; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="text-xs font-semibold text-muted-foreground">
      {children}
    </label>
  );
}

/**
 * Presentation only. Search, filters, sorting and refresh all call the same handlers the
 * page already had; this component just lays them out.
 */
export function ActivityLogFilterBar({
  filters,
  searchInput,
  committees,
  committeeLabels,
  filtersOpen,
  activeFilterCount,
  showClearFilters,
  refreshing,
  navigating,
  onSearchChange,
  onFilterChange,
  onToggleFilters,
  onClearFilters,
  onRefresh,
}: Props) {
  const radioRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(
    quickActions.findIndex((option) => option.value === (filters.action ?? null)),
    0,
  );

  // Radio-group keyboard behaviour: one Tab stop, arrow keys move and select, Home/End jump.
  function onRadioKeyDown(event: React.KeyboardEvent, index: number) {
    const last = quickActions.length - 1;
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = index === last ? 0 : index + 1;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = index === 0 ? last : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    if (next === null) return;
    event.preventDefault();
    onFilterChange({ action: quickActions[next].value });
    radioRefs.current[next]?.focus();
  }

  return (
    <div className="grid grid-cols-1 gap-3 rounded-2xl border bg-card p-3 sm:p-4">
      <div className="flex items-center gap-2">
        <label htmlFor="activity-log-search" className="relative min-w-0 flex-1">
          <span className="sr-only">Search activity</span>
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            id="activity-log-search"
            value={searchInput}
            maxLength={101}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search activity"
            className="pl-10"
          />
        </label>
        <Button
          type="button"
          variant="outline"
          className="xl:hidden"
          aria-expanded={filtersOpen}
          aria-controls="activity-log-filters"
          onClick={onToggleFilters}
        >
          <SlidersHorizontal aria-hidden />
          Filters
          {activeFilterCount > 0 ? (
            <span className="inline-flex size-5 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              {activeFilterCount}
              <span className="sr-only"> active filters</span>
            </span>
          ) : null}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={onRefresh}
          disabled={refreshing || navigating}
          aria-label="Refresh activity log"
          title="Refresh activity log"
        >
          <RefreshCw className={refreshing ? "animate-spin motion-reduce:animate-none" : ""} />
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div
          role="radiogroup"
          aria-label="Filter by action"
          className="grid w-full grid-cols-4 gap-1 rounded-xl bg-secondary p-1 sm:w-auto sm:min-w-96"
        >
          {quickActions.map((option, index) => {
            const selected = (filters.action ?? null) === option.value;
            const Icon = option.icon;
            return (
              <button
                key={option.label}
                ref={(node) => {
                  radioRefs.current[index] = node;
                }}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={index === selectedIndex ? 0 : -1}
                onKeyDown={(event) => onRadioKeyDown(event, index)}
                onClick={() => onFilterChange({ action: option.value })}
                className={cn(
                  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-semibold outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none md:min-h-9",
                  selected
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {Icon ? <Icon className="hidden size-3.5 min-[400px]:block" aria-hidden /> : null}
                {option.label}
              </button>
            );
          })}
        </div>
        {showClearFilters ? (
          <Button type="button" variant="ghost" onClick={onClearFilters}>
            <X aria-hidden />
            Clear filters
          </Button>
        ) : null}
      </div>

      <ResponsiveCollapse open={filtersOpen} openFrom="xl" className="-mx-1">
      <div className="px-1 pb-1">
      <div
        id="activity-log-filters"
        className="grid gap-3 border-t pt-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        <div className="grid min-w-0 gap-1.5">
          <FieldLabel>Sort by</FieldLabel>
          <Select
            items={ACTIVITY_SORT_LABELS}
            value={filters.sort}
            onValueChange={(value) =>
              value && onFilterChange({ sort: value as ActivityFilters["sort"] })
            }
          >
            <SelectTrigger className="w-full" aria-label="Sort order">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(ACTIVITY_SORT_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid min-w-0 gap-1.5">
          <FieldLabel>Committee</FieldLabel>
          <Select
            items={committeeLabels}
            value={filters.committeeId ?? "all"}
            onValueChange={(value) =>
              onFilterChange({ committeeId: value === "all" ? null : value })
            }
          >
            <SelectTrigger className="w-full" aria-label="Filter by committee">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All committees</SelectItem>
              {committees.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid min-w-0 gap-1.5">
          <FieldLabel htmlFor="activity-date-from">From date</FieldLabel>
          <Input
            id="activity-date-from"
            type="date"
            value={filters.dateFrom ?? ""}
            onChange={(event) => onFilterChange({ dateFrom: event.target.value || null })}
          />
        </div>
        <div className="grid min-w-0 gap-1.5">
          <FieldLabel htmlFor="activity-date-to">To date</FieldLabel>
          <Input
            id="activity-date-to"
            type="date"
            value={filters.dateTo ?? ""}
            onChange={(event) => onFilterChange({ dateTo: event.target.value || null })}
          />
        </div>
      </div>
      </div>
      </ResponsiveCollapse>
    </div>
  );
}
