import { ChevronsLeft, ChevronsRight, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PagerSlot = {
  key: string;
  page: number | null;
};

type ListPagerProps = {
  activePage: number;
  ariaLabel: string;
  className?: string;
  navigationDisabled?: boolean;
  nextBusy?: boolean;
  nextDisabled: boolean;
  nextTitle?: string;
  onNext: () => void;
  onPage: (page: number) => void;
  onPrevious: () => void;
  pageSize: number;
  previousDisabled: boolean;
  previousTitle?: string;
  slots: readonly PagerSlot[];
};

export function ListPager({
  activePage,
  ariaLabel,
  className,
  navigationDisabled = false,
  nextBusy = false,
  nextDisabled,
  nextTitle,
  onNext,
  onPage,
  onPrevious,
  pageSize,
  previousDisabled,
  previousTitle,
  slots,
}: ListPagerProps) {
  return (
    <div className={cn("grid gap-2 border-t pt-3 sm:grid-cols-[1fr_auto] sm:items-center", className)}>
      <p className="text-center text-sm text-muted-foreground sm:text-left">
        Showing {pageSize} per page
      </p>
      <nav className="flex min-h-11 items-center justify-center gap-2" aria-label={ariaLabel}>
        <Button
          variant="outline"
          size="icon"
          aria-label="Previous page block"
          title={previousTitle}
          disabled={previousDisabled || navigationDisabled}
          onClick={onPrevious}
        >
          <ChevronsLeft aria-hidden />
        </Button>
        <div className="grid grid-cols-3 gap-2" aria-label="Known pages">
          {slots.map((slot) => {
            const page = slot.page;
            return page ? (
              <Button
                key={slot.key}
                variant={page === activePage ? "default" : "outline"}
                size="icon"
                aria-label={`Page ${page}`}
                aria-current={page === activePage ? "page" : undefined}
                disabled={page === activePage || navigationDisabled}
                onClick={() => onPage(page)}
              >
                {page}
              </Button>
            ) : (
              <span key={slot.key} className="size-11 md:size-9" aria-hidden />
            );
          })}
        </div>
        <Button
          variant="outline"
          size="icon"
          aria-label={nextBusy ? "Preparing next page block" : "Next page block"}
          title={nextTitle}
          disabled={nextDisabled || navigationDisabled}
          onClick={onNext}
        >
          {nextBusy ? (
            <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
          ) : (
            <ChevronsRight aria-hidden />
          )}
        </Button>
      </nav>
    </div>
  );
}
