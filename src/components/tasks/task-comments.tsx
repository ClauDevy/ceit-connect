"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AtSign,
  Ellipsis,
  MessageSquare,
  Pencil,
  RefreshCw,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { MotionPresence } from "@/components/shared/motion";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { preventSearchFormSubmission } from "@/lib/search";
import { Skeleton } from "@/components/ui/skeleton";
import {
  countCodePoints,
  getTaskCommentErrorCode,
  getTaskCommentErrorMessage,
  isAddTaskCommentResult,
  isEditTaskCommentResult,
  isTaskComment,
  isTaskCommentMentionCandidate,
  isTaskCommentRetryableError,
  isTaskCommentUnavailableError,
  MAX_TASK_COMMENT_CODE_POINTS,
  MAX_TASK_COMMENT_MENTIONS,
  MAX_TASK_COMMENT_MENTION_SEARCH_CODE_POINTS,
  mergeTaskCommentPages,
  replaceTaskCommentNewestPage,
  TASK_COMMENT_PAGE_SIZE,
  trimTaskCommentBody,
  truncateCodePoints,
  type TaskComment,
  type TaskCommentAction,
  type TaskCommentMention,
  type TaskCommentMentionCandidate,
} from "@/lib/tasks/comments";
import { createClient } from "@/lib/supabase/client";
import { APP_TIME_ZONE } from "@/lib/timezone";

const POLL_INTERVAL_MS = 15_000;

const commentDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: APP_TIME_ZONE.iana,
});

type MentionChoice = {
  id: string;
  fullName: string;
  avatarUrl: string | null;
};

type TaskCommentsProps = {
  taskId: string;
  isArchived: boolean;
  onRefreshTask: () => Promise<void>;
};

type TaskCommentThreadCache = {
  comments: TaskComment[];
  hasMore: boolean;
  olderPagingStarted: boolean;
};

type CommentFormProps = {
  mode: "add" | "edit";
  initialBody?: string;
  initialHeadsUp?: boolean;
  initialMentions?: TaskCommentMention[];
  busy: boolean;
  onUnavailable: (error: unknown) => void;
  onCancel?: () => void;
  onSubmit: (input: {
    body: string;
    isHeadsUp: boolean;
    mentionedUserIds: string[];
  }) => Promise<boolean>;
};

function candidateToChoice(
  candidate: TaskCommentMentionCandidate,
): MentionChoice {
  return {
    id: candidate.out_id,
    fullName: candidate.out_full_name,
    avatarUrl: candidate.out_avatar_url,
  };
}

function mentionToChoice(mention: TaskCommentMention): MentionChoice {
  return {
    id: mention.id,
    fullName: mention.full_name,
    avatarUrl: null,
  };
}

function MentionPicker({
  taskId,
  selected,
  disabled,
  onChange,
  onUnavailable,
}: {
  taskId: string;
  selected: MentionChoice[];
  disabled: boolean;
  onChange: (mentions: MentionChoice[]) => void;
  onUnavailable: (error: unknown) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const inputId = useId();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const candidatesQuery = useQuery({
    queryKey: ["task-comment-mention-candidates", taskId, debouncedSearch],
    queryFn: async ({ signal }) => {
      let request = supabase.rpc("list_task_comment_mention_candidates", {
        p_task_id: taskId,
        p_search: debouncedSearch || null,
        p_limit: MAX_TASK_COMMENT_MENTIONS,
      });
      request = request.abortSignal(signal);
      const { data, error } = await request;
      if (error) {
        if (isTaskCommentUnavailableError(error)) onUnavailable(error);
        throw error;
      }
      if (!Array.isArray(data) || !data.every(isTaskCommentMentionCandidate)) {
        throw new Error(
          "The mention candidate reader returned an invalid response.",
        );
      }
      return data;
    },
    enabled: open && !disabled,
    retry: (failureCount, error) =>
      !isTaskCommentUnavailableError(error) && failureCount < 1,
    refetchOnWindowFocus: false,
  });

  const selectedIds = useMemo(
    () => new Set(selected.map((mention) => mention.id)),
    [selected],
  );
  const availableCandidates = (candidatesQuery.data ?? []).filter(
    (candidate) => !selectedIds.has(candidate.out_id),
  );

  function addCandidate(candidate: TaskCommentMentionCandidate) {
    if (selected.length >= MAX_TASK_COMMENT_MENTIONS) return;
    onChange([...selected, candidateToChoice(candidate)]);
    setSearch("");
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <label
          htmlFor={inputId}
          className="text-xs font-semibold text-muted-foreground"
        >
          Mention people
        </label>
        <span className="text-xs text-muted-foreground">
          {selected.length}/{MAX_TASK_COMMENT_MENTIONS}
        </span>
      </div>

      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-2" aria-label="Selected mentions">
          {selected.map((mention) => (
            <span
              key={mention.id}
              className="inline-flex items-center gap-1 rounded-full border bg-muted px-2.5 py-1 text-xs font-medium"
            >
              {mention.fullName}
              <button
                type="button"
                className="rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Remove ${mention.fullName}`}
                disabled={disabled}
                onClick={() =>
                  onChange(selected.filter((item) => item.id !== mention.id))
                }
              >
                <X className="size-3" aria-hidden />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div
        className="relative"
        onBlur={(event) => {
          const nextFocus = event.relatedTarget as Node | null;
          if (!event.currentTarget.contains(nextFocus)) setOpen(false);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !open) return;
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
        }}
      >
        <AtSign
          className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground"
          aria-hidden
        />
        <Input
          id={inputId}
          type="search"
          value={search}
          className="pl-9"
          placeholder="Search people to mention"
          autoComplete="off"
          disabled={disabled || selected.length >= MAX_TASK_COMMENT_MENTIONS}
          aria-expanded={open}
          aria-controls={`${inputId}-results`}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={preventSearchFormSubmission}
          onChange={(event) => {
            setOpen(true);
            setSearch(
              truncateCodePoints(
                event.target.value,
                MAX_TASK_COMMENT_MENTION_SEARCH_CODE_POINTS,
              ),
            );
          }}
        />

        <MotionPresence open={open}>
          <div
            id={`${inputId}-results`}
            role="listbox"
            className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border bg-card p-1 shadow-lg"
            onMouseDown={(event) => event.preventDefault()}
          >
            {candidatesQuery.isPending ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">
                Loading people…
              </p>
            ) : candidatesQuery.error ? (
              <div className="space-y-2 p-2">
                <p className="text-sm text-muted-foreground">
                  {getTaskCommentErrorMessage(
                    candidatesQuery.error,
                    "candidates",
                  )}
                </p>
                {!isTaskCommentUnavailableError(candidatesQuery.error) ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void candidatesQuery.refetch()}
                  >
                    Retry
                  </Button>
                ) : null}
              </div>
            ) : availableCandidates.length > 0 ? (
              availableCandidates.map((candidate) => (
                <button
                  key={candidate.out_id}
                  type="button"
                  role="option"
                  aria-selected="false"
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                  onClick={() => addCandidate(candidate)}
                >
                  <UserAvatar
                    name={candidate.out_full_name}
                    src={candidate.out_avatar_url}
                    size="sm"
                  />
                  <span className="min-w-0 truncate font-medium">
                    {candidate.out_full_name}
                  </span>
                </button>
              ))
            ) : (
              <p className="px-3 py-2 text-sm text-muted-foreground">
                No available people found.
              </p>
            )}
          </div>
        </MotionPresence>
      </div>
    </div>
  );
}

function CommentForm({
  taskId,
  mode,
  initialBody = "",
  initialHeadsUp = false,
  initialMentions = [],
  busy,
  onUnavailable,
  onCancel,
  onSubmit,
}: CommentFormProps & { taskId: string }) {
  const textareaId = useId();
  const headsUpId = useId();
  const [body, setBody] = useState(initialBody);
  const [isHeadsUp, setIsHeadsUp] = useState(initialHeadsUp);
  const [mentions, setMentions] = useState<MentionChoice[]>(
    initialMentions.map(mentionToChoice),
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const trimmedBody = trimTaskCommentBody(body);
  const bodyLength = countCodePoints(trimmedBody);
  const invalidBody =
    bodyLength < 1 || bodyLength > MAX_TASK_COMMENT_CODE_POINTS;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (invalidBody) {
      setValidationError(
        "A comment must contain between 1 and 4,000 characters.",
      );
      return;
    }
    setValidationError(null);
    const saved = await onSubmit({
      body: trimmedBody,
      isHeadsUp,
      mentionedUserIds: mentions.map((mention) => mention.id),
    });
    if (saved && mode === "add") {
      setBody("");
      setIsHeadsUp(false);
      setMentions([]);
    }
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      <div className="space-y-1.5">
        <label htmlFor={textareaId} className="text-sm font-semibold">
          {mode === "add" ? "Add a comment" : "Edit comment"}
        </label>
        <textarea
          id={textareaId}
          value={body}
          rows={mode === "add" ? 4 : 3}
          disabled={busy}
          aria-invalid={
            Boolean(validationError) ||
            bodyLength > MAX_TASK_COMMENT_CODE_POINTS
          }
          className="w-full resize-y rounded-xl border border-input bg-card px-3.5 py-3 text-sm outline-none transition-[color,box-shadow,border-color] duration-[var(--motion-interaction-duration)] ease-[var(--motion-enter-easing)] placeholder:text-muted-foreground hover:border-primary/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 motion-reduce:transition-none dark:bg-input/30"
          placeholder="Write a plain-text update…"
          onChange={(event) => {
            setBody(event.target.value);
            setValidationError(null);
          }}
        />
        <div className="flex items-center justify-between gap-3 text-xs">
          <label
            htmlFor={headsUpId}
            className="flex items-center gap-2 font-medium"
          >
            <input
              id={headsUpId}
              type="checkbox"
              checked={isHeadsUp}
              disabled={busy}
              className="size-4 rounded border-input accent-primary"
              onChange={(event) => setIsHeadsUp(event.target.checked)}
            />
            Heads Up
          </label>
          <span
            className={
              bodyLength > MAX_TASK_COMMENT_CODE_POINTS
                ? "font-semibold text-destructive"
                : "text-muted-foreground"
            }
          >
            {bodyLength.toLocaleString()}/
            {MAX_TASK_COMMENT_CODE_POINTS.toLocaleString()}
          </span>
        </div>
      </div>

      <MentionPicker
        taskId={taskId}
        selected={mentions}
        disabled={busy}
        onChange={setMentions}
        onUnavailable={onUnavailable}
      />

      {validationError ? <InlineAlert>{validationError}</InlineAlert> : null}

      <div className="flex flex-wrap justify-end gap-2">
        {onCancel ? (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </Button>
        ) : null}
        <Button type="submit" disabled={busy || invalidBody}>
          {mode === "add" ? <Send aria-hidden /> : null}
          {busy ? "Saving…" : mode === "add" ? "Comment" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

export function TaskComments({
  taskId,
  isArchived,
  onRefreshTask,
}: TaskCommentsProps) {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [mutationAction, setMutationAction] =
    useState<TaskCommentAction | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [unavailableError, setUnavailableError] = useState<string | null>(null);
  const [editingComment, setEditingComment] = useState<TaskComment | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<TaskComment | null>(null);
  const newestQueryKey = useMemo(
    () => ["task-comments", taskId, "newest"] as const,
    [taskId],
  );

  const handleUnavailable = useCallback(
    async (error: unknown) => {
      queryClient.setQueryData(newestQueryKey, {
        comments: [],
        hasMore: false,
        olderPagingStarted: false,
      });
      setUnavailableError(getTaskCommentErrorMessage(error, "read"));
      setThreadError(null);
      setEditingComment(null);
      setDeleteTarget(null);
      await onRefreshTask();
    },
    [newestQueryKey, onRefreshTask, queryClient],
  );

  const newestQuery = useQuery({
    queryKey: newestQueryKey,
    queryFn: async ({ signal }) => {
      let request = supabase.rpc("list_task_comments", {
        p_task_id: taskId,
        p_limit: TASK_COMMENT_PAGE_SIZE,
        p_before_created_at: null,
        p_before_id: null,
      });
      request = request.abortSignal(signal);
      const { data, error } = await request;
      if (error) {
        if (isTaskCommentUnavailableError(error)) {
          await handleUnavailable(error);
        }
        throw error;
      }
      if (!Array.isArray(data) || !data.every(isTaskComment)) {
        throw new Error("The comment reader returned an invalid response.");
      }
      const current =
        queryClient.getQueryData<TaskCommentThreadCache>(newestQueryKey);
      return {
        comments: replaceTaskCommentNewestPage(current?.comments ?? [], data),
        hasMore: current?.olderPagingStarted
          ? current.hasMore
          : (data[0]?.out_has_more ?? false),
        olderPagingStarted: current?.olderPagingStarted ?? false,
      };
    },
    retry: (failureCount, error) =>
      !isTaskCommentUnavailableError(error) && failureCount < 1,
    refetchOnWindowFocus: mutationAction === null,
    refetchInterval: mutationAction === null ? POLL_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
  });

  const unavailable =
    unavailableError !== null ||
    isTaskCommentUnavailableError(newestQuery.error);
  const comments = unavailable ? [] : (newestQuery.data?.comments ?? []);
  const hasMore = unavailable ? false : (newestQuery.data?.hasMore ?? false);
  const newestError = newestQuery.error
    ? getTaskCommentErrorMessage(newestQuery.error, "read")
    : null;
  const displayedThreadError = unavailableError ?? threadError ?? newestError;

  async function refreshAfterMutation() {
    await Promise.all([newestQuery.refetch(), onRefreshTask()]);
  }

  async function runMutation(
    action: Exclude<TaskCommentAction, "read" | "candidates">,
    mutation: () => Promise<void>,
  ) {
    if (mutationAction) return false;
    setMutationAction(action);
    setActionError(null);
    let saved = false;
    try {
      await mutation();
      saved = true;
    } catch (error) {
      if (isTaskCommentUnavailableError(error)) {
        await handleUnavailable(error);
      } else {
        const code = getTaskCommentErrorCode(error);
        if (
          isTaskCommentRetryableError(error) ||
          ["CCC05", "CCC06", "CCC07", "CCC08", "CCC10"].includes(code)
        ) {
          await refreshAfterMutation();
        }
        if (code === "CCC08") setEditingComment(null);
        setActionError(getTaskCommentErrorMessage(error, action));
      }
    } finally {
      try {
        if (saved) await refreshAfterMutation();
      } finally {
        setMutationAction(null);
      }
    }
    return saved;
  }

  async function addComment(input: {
    body: string;
    isHeadsUp: boolean;
    mentionedUserIds: string[];
  }) {
    return runMutation("add", async () => {
      const { data, error } = await supabase.rpc("add_task_comment", {
        p_task_id: taskId,
        p_body: input.body,
        p_is_heads_up: input.isHeadsUp,
        p_mentioned_user_ids: input.mentionedUserIds,
      });
      if (error) throw error;
      if (
        !Array.isArray(data) ||
        data.length !== 1 ||
        !isAddTaskCommentResult(data[0])
      ) {
        throw new Error("The comment writer returned an invalid response.");
      }
    });
  }

  async function editComment(
    comment: TaskComment,
    input: {
      body: string;
      isHeadsUp: boolean;
      mentionedUserIds: string[];
    },
  ) {
    const saved = await runMutation("edit", async () => {
      const { data, error } = await supabase.rpc("edit_task_comment", {
        p_comment_id: comment.out_id,
        p_body: input.body,
        p_is_heads_up: input.isHeadsUp,
        p_mentioned_user_ids: input.mentionedUserIds,
        p_expected_edited_at: comment.out_edited_at,
      });
      if (error) throw error;
      if (
        !Array.isArray(data) ||
        data.length !== 1 ||
        !isEditTaskCommentResult(data[0])
      ) {
        throw new Error("The comment editor returned an invalid response.");
      }
    });
    if (saved) setEditingComment(null);
    return saved;
  }

  async function deleteComment() {
    if (!deleteTarget) return;
    const targetId = deleteTarget.out_id;
    const saved = await runMutation("delete", async () => {
      const { error } = await supabase.rpc("delete_task_comment", {
        p_comment_id: targetId,
      });
      if (error) throw error;
    });
    if (saved) {
      queryClient.setQueryData<TaskCommentThreadCache>(
        newestQueryKey,
        (current) => ({
          comments: (current?.comments ?? []).filter(
            (comment) => comment.out_id !== targetId,
          ),
          hasMore: current?.hasMore ?? false,
          olderPagingStarted: current?.olderPagingStarted ?? false,
        }),
      );
      setDeleteTarget(null);
    }
  }

  async function loadOlder() {
    const oldest = comments.at(-1);
    if (!oldest || loadingOlder || mutationAction) return;
    setLoadingOlder(true);
    setThreadError(null);
    try {
      const { data, error } = await supabase.rpc("list_task_comments", {
        p_task_id: taskId,
        p_limit: TASK_COMMENT_PAGE_SIZE,
        p_before_created_at: oldest.out_created_at,
        p_before_id: oldest.out_id,
      });
      if (error) throw error;
      if (!Array.isArray(data) || !data.every(isTaskComment)) {
        throw new Error("The comment reader returned an invalid response.");
      }
      queryClient.setQueryData<TaskCommentThreadCache>(
        newestQueryKey,
        (current) => ({
          comments: mergeTaskCommentPages(current?.comments ?? [], data),
          hasMore: data[0]?.out_has_more ?? false,
          olderPagingStarted: true,
        }),
      );
    } catch (error) {
      if (isTaskCommentUnavailableError(error)) {
        await handleUnavailable(error);
      } else {
        setThreadError(getTaskCommentErrorMessage(error, "read"));
      }
    } finally {
      setLoadingOlder(false);
    }
  }

  const commentsBusy = mutationAction !== null;

  return (
    <Card>
      <CardHeader className="px-4 pt-4 pb-0 sm:px-5 sm:pt-5">
        <CardTitle className="flex items-center gap-2 text-[15px]">
          <MessageSquare className="size-5" aria-hidden /> Collaboration &amp;
          Activity
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 px-4 pt-3 pb-4 sm:px-5 sm:pb-5">
        {displayedThreadError ? (
          <InlineAlert className="flex flex-wrap items-center justify-between gap-3">
            <span>{displayedThreadError}</span>
            {!unavailable ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={commentsBusy}
                onClick={() => {
                  setThreadError(null);
                  void newestQuery.refetch();
                }}
              >
                <RefreshCw aria-hidden /> Retry
              </Button>
            ) : null}
          </InlineAlert>
        ) : null}

        {actionError ? <InlineAlert>{actionError}</InlineAlert> : null}

        {!isArchived && !unavailable ? (
          <CommentForm
            taskId={taskId}
            mode="add"
            busy={commentsBusy}
            onUnavailable={handleUnavailable}
            onSubmit={addComment}
          />
        ) : null}

        <div className="border-t pt-5">
          {newestQuery.isPending ? (
            <div className="space-y-4" aria-label="Loading comments">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : comments.length === 0 && !unavailable ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No comments yet.
            </p>
          ) : (
            <div className="space-y-5">
              {comments.map((comment) => (
                <article key={comment.out_id} className="flex gap-3">
                  <UserAvatar
                    name={comment.out_author_full_name}
                    src={comment.out_author_avatar_url}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-semibold">
                        {comment.out_author_full_name}
                      </span>
                      <time
                        dateTime={comment.out_created_at}
                        className="text-xs text-muted-foreground"
                      >
                        {commentDateFormatter.format(
                          new Date(comment.out_created_at),
                        )}
                      </time>
                      {comment.out_edited_at ? (
                        <span className="text-xs text-muted-foreground">
                          (edited)
                        </span>
                      ) : null}
                      {comment.out_is_heads_up ? (
                        <Badge variant="outline">Heads Up</Badge>
                      ) : null}
                    </div>

                    {editingComment?.out_id === comment.out_id &&
                    !isArchived ? (
                      <div className="mt-3">
                        <CommentForm
                          taskId={taskId}
                          mode="edit"
                          initialBody={editingComment.out_body}
                          initialHeadsUp={editingComment.out_is_heads_up}
                          initialMentions={editingComment.out_mentions}
                          busy={commentsBusy}
                          onUnavailable={handleUnavailable}
                          onCancel={() => setEditingComment(null)}
                          onSubmit={(input) =>
                            editComment(editingComment, input)
                          }
                        />
                      </div>
                    ) : (
                      <>
                        <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">
                          {comment.out_body}
                        </p>
                        {comment.out_mentions.length > 0 ? (
                          <div
                            className="mt-2 flex flex-wrap gap-1.5"
                            aria-label="Mentioned people"
                          >
                            {comment.out_mentions.map((mention) => (
                              <Badge key={mention.id} variant="neutral">
                                @{mention.full_name}
                              </Badge>
                            ))}
                          </div>
                        ) : null}
                        {!isArchived &&
                        (comment.out_can_edit || comment.out_can_delete) ? (
                          <div className="mt-2 flex flex-wrap items-center justify-end gap-1">
                            {comment.out_can_edit ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={commentsBusy}
                                onClick={() => {
                                  setActionError(null);
                                  setEditingComment(comment);
                                }}
                              >
                                <Pencil aria-hidden /> Edit
                              </Button>
                            ) : null}
                            {comment.out_can_delete ? (
                              <DropdownMenu>
                                <DropdownMenuTrigger
                                  aria-label={`More actions for ${comment.out_author_full_name}'s comment`}
                                  disabled={commentsBusy}
                                  className="inline-flex size-11 items-center justify-center rounded-xl text-muted-foreground outline-none transition-colors duration-150 hover:bg-accent hover:text-accent-foreground active:bg-accent/80 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none sm:size-9"
                                >
                                  <Ellipsis aria-hidden className="size-5" />
                                </DropdownMenuTrigger>
                                <DropdownMenuContent aria-label="Comment actions">
                                  <DropdownMenuItem
                                    className="text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive"
                                    onClick={() => {
                                      setActionError(null);
                                      setDeleteTarget(comment);
                                    }}
                                  >
                                    <Trash2 aria-hidden className="size-4" />
                                    Delete comment
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            ) : null}
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        {hasMore && comments.length > 0 && !unavailable ? (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={loadingOlder || commentsBusy}
            onClick={() => void loadOlder()}
          >
            {loadingOlder ? "Loading…" : "Load older comments"}
          </Button>
        ) : null}
      </CardContent>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete comment?"
        description="This permanently removes the comment from the task thread."
        confirmLabel="Delete comment"
        destructive
        loading={mutationAction === "delete"}
        onConfirm={() => void deleteComment()}
      />
    </Card>
  );
}
