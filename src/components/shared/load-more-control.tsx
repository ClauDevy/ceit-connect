"use client";

import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";

export function LoadMoreControl({
  announcement,
  disabled = false,
  errorMessage,
  hasLoadedMore,
  hasMore,
  isLoading,
  onLoadMore,
  onRetry,
}: {
  announcement: string;
  disabled?: boolean;
  errorMessage?: string;
  hasLoadedMore: boolean;
  hasMore: boolean;
  isLoading: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
}) {
  const showFinalState = hasLoadedMore && !hasMore && !errorMessage;
  if (!hasMore && !showFinalState && !announcement && !errorMessage) {
    return null;
  }

  return (
    <div className="space-y-2">
      {errorMessage ? <InlineAlert>{errorMessage}</InlineAlert> : null}
      {hasMore || showFinalState || errorMessage ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            disabled={disabled || isLoading || showFinalState}
            onClick={errorMessage ? onRetry : onLoadMore}
          >
            {isLoading ? (
              <LoaderCircle className="animate-spin" aria-hidden />
            ) : null}
            {isLoading
              ? "Loading more..."
              : errorMessage
                ? "Retry"
                : showFinalState
                  ? "All items loaded"
                  : "Load more"}
          </Button>
        </div>
      ) : null}
      <p
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {announcement}
      </p>
    </div>
  );
}
