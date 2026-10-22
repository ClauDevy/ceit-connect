-- Phase 4 Step 9-DB (part 2): task comments without Phase 5 notifications.
-- Authenticated clients have no direct table privileges. All reads and writes
-- use the fixed-shape functions below and re-check current real task access.

create function public.task_comment_trim_body(p_body text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select pg_catalog.regexp_replace(
    p_body,
    '^[[:space:]]+|[[:space:]]+$',
    '',
    'g'
  );
$$;

alter function public.task_comment_trim_body(text)
owner to postgres;

revoke all on function public.task_comment_trim_body(text)
from public, anon, authenticated;

create function public.normalize_task_comment_mentions(p_mentioned_user_ids uuid[])
returns uuid[]
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_mentions uuid[] := coalesce(p_mentioned_user_ids, '{}'::uuid[]);
  v_total integer;
  v_distinct integer;
  v_has_null boolean;
  v_normalized uuid[];
begin
  select
    count(*)::integer,
    count(distinct mention_id)::integer,
    coalesce(bool_or(mention_id is null), false)
  into v_total, v_distinct, v_has_null
  from unnest(v_mentions) mentions(mention_id);

  if v_total > 20 or v_has_null or v_total <> v_distinct then
    raise exception using
      errcode = 'CCC04',
      message = 'Mentions must contain at most 20 unique user IDs.';
  end if;

  select coalesce(array_agg(mention_id order by mention_id), '{}'::uuid[])
  into v_normalized
  from unnest(v_mentions) mentions(mention_id);

  return v_normalized;
end;
$$;

alter function public.normalize_task_comment_mentions(uuid[])
owner to postgres;

revoke all on function public.normalize_task_comment_mentions(uuid[])
from public, anon, authenticated;

create function public.task_comment_mentions_are_valid(
  p_task_id uuid,
  p_mentioned_user_ids uuid[]
)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from unnest(p_mentioned_user_ids) mentions(mention_id)
    left join public.users mentioned_user
      on mentioned_user.id = mentions.mention_id
     and mentioned_user.is_active is true
    where mentioned_user.id is null
       or public.task_content_access_for_user(
            p_task_id,
            mentions.mention_id
          ) <> 'real'
  );
$$;

alter function public.task_comment_mentions_are_valid(uuid, uuid[])
owner to postgres;

revoke all on function public.task_comment_mentions_are_valid(uuid, uuid[])
from public, anon, authenticated;

create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null
    references public.tasks(id) on delete cascade,
  created_by uuid not null
    references public.users(id),
  body text not null,
  is_heads_up boolean not null default false,
  mentioned_user_ids uuid[] not null default '{}'::uuid[],
  created_at timestamptz not null default clock_timestamp(),
  edited_at timestamptz,
  constraint task_comments_body_length check (
    body = public.task_comment_trim_body(body)
    and char_length(body) between 1 and 4000
  ),
  constraint task_comments_mention_count check (
    cardinality(mentioned_user_ids) <= 20
  ),
  constraint task_comments_mention_nulls check (
    array_position(mentioned_user_ids, null) is null
  ),
  constraint task_comments_edited_after_creation check (
    edited_at is null or edited_at >= created_at
  )
);

alter table public.task_comments owner to postgres;

create index task_comments_task_thread_idx
on public.task_comments (task_id, created_at desc, id desc);

create index task_comments_mentions_idx
on public.task_comments using gin (mentioned_user_ids);

alter table public.task_comments enable row level security;

revoke all on table public.task_comments
from public, anon, authenticated;

create function public.guard_task_comment_writes()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_task_id uuid := case when TG_OP = 'INSERT' then new.task_id else old.task_id end;
  v_event_id uuid;
  v_event_status text;
  v_body text;
  v_mentions uuid[];
begin
  if TG_OP = 'UPDATE'
     and new.task_id is distinct from old.task_id then
    raise exception using
      errcode = 'CCC10',
      message = 'A comment cannot be moved to another task.';
  end if;

  -- Child-specific parent lock order: task first, then its stored event.
  select task_row.event_id
  into v_event_id
  from public.tasks task_row
  where task_row.id = v_task_id
  for no key update;

  if not found then
    if TG_OP = 'DELETE' and pg_trigger_depth() > 1 then
      return old;
    end if;

    raise exception using
      errcode = '40001',
      message = 'The comment task changed. Refresh and try again.';
  end if;

  select event_row.status
  into v_event_status
  from public.events event_row
  where event_row.id = v_event_id
  for share;

  if not found or not exists (
    select 1
    from public.tasks task_row
    where task_row.id = v_task_id
      and task_row.event_id = v_event_id
  ) then
    raise exception using
      errcode = '40001',
      message = 'The comment task changed. Refresh and try again.';
  end if;

  if public.task_content_access(v_task_id) <> 'real' then
    raise exception using
      errcode = 'CCC01',
      message = 'The task comments are unavailable.';
  end if;

  if v_event_status = 'Archived' then
    raise exception using
      errcode = 'CCC05',
      message = 'Archived task comments are read-only.';
  end if;

  select user_row.role
  into v_caller_role
  from public.users user_row
  where user_row.id = v_caller_id
    and user_row.is_active is true;

  if not found then
    raise exception using
      errcode = 'CCC01',
      message = 'The task comments are unavailable.';
  end if;

  if TG_OP = 'DELETE' then
    if old.created_by is distinct from v_caller_id
       and v_caller_role <> 'Admin' then
      raise exception using
        errcode = 'CCC07',
        message = 'You cannot delete this comment.';
    end if;

    return old;
  end if;

  v_body := public.task_comment_trim_body(new.body);
  if v_body is null or char_length(v_body) not between 1 and 4000
     or new.is_heads_up is null then
    raise exception using
      errcode = 'CCC03',
      message = 'A comment must contain between 1 and 4000 characters.';
  end if;

  v_mentions := public.normalize_task_comment_mentions(
    new.mentioned_user_ids
  );

  if not public.task_comment_mentions_are_valid(
    v_task_id,
    v_mentions
  ) then
    raise exception using
      errcode = 'CCC04',
      message = 'Every mentioned user must be an available active user with full task access.';
  end if;

  new.body := v_body;
  new.mentioned_user_ids := v_mentions;

  if TG_OP = 'INSERT' then
    new.created_by := v_caller_id;
    new.created_at := clock_timestamp();
    new.edited_at := null;
    return new;
  end if;

  if old.created_by is distinct from v_caller_id then
    raise exception using
      errcode = 'CCC06',
      message = 'Only the comment author can edit it.';
  end if;

  if (
    new.id,
    new.task_id,
    new.created_by,
    new.created_at
  ) is distinct from (
    old.id,
    old.task_id,
    old.created_by,
    old.created_at
  ) then
    raise exception using
      errcode = 'CCC10',
      message = 'Comment identity and creation fields are immutable.';
  end if;

  if (
    new.body,
    new.is_heads_up,
    new.mentioned_user_ids
  ) is not distinct from (
    old.body,
    old.is_heads_up,
    old.mentioned_user_ids
  ) then
    raise exception using
      errcode = 'CCC09',
      message = 'Make a change before saving the comment.';
  end if;

  new.edited_at := clock_timestamp();
  return new;
end;
$$;

alter function public.guard_task_comment_writes()
owner to postgres;

revoke all on function public.guard_task_comment_writes()
from public, anon, authenticated;

create trigger task_comments_guard_writes
before insert or update or delete on public.task_comments
for each row
execute function public.guard_task_comment_writes();

create function public.list_task_comments(
  p_task_id uuid,
  p_limit integer default 25,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  out_id uuid,
  out_body text,
  out_is_heads_up boolean,
  out_created_at timestamptz,
  out_edited_at timestamptz,
  out_author_id uuid,
  out_author_full_name text,
  out_author_avatar_url text,
  out_mentions jsonb,
  out_can_edit boolean,
  out_can_delete boolean,
  out_has_more boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_event_status text;
begin
  if public.task_content_access(p_task_id) <> 'real' then
    raise exception using
      errcode = 'CCC01',
      message = 'The task comments are unavailable.';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 50
     or ((p_before_created_at is null) <> (p_before_id is null)) then
    raise exception using
      errcode = 'CCC02',
      message = 'Comment pagination is invalid.';
  end if;

  select user_row.role
  into v_caller_role
  from public.users user_row
  where user_row.id = v_caller_id
    and user_row.is_active is true;

  if not found then
    raise exception using
      errcode = 'CCC01',
      message = 'The task comments are unavailable.';
  end if;

  select event_row.status
  into v_event_status
  from public.tasks task_row
  join public.events event_row on event_row.id = task_row.event_id
  where task_row.id = p_task_id;

  if not found then
    raise exception using
      errcode = 'CCC01',
      message = 'The task comments are unavailable.';
  end if;

  return query
  with candidates as materialized (
    select comment_row.*
    from public.task_comments comment_row
    where comment_row.task_id = p_task_id
      and (
        p_before_created_at is null
        or (comment_row.created_at, comment_row.id)
          < (p_before_created_at, p_before_id)
      )
    order by comment_row.created_at desc, comment_row.id desc
    limit p_limit + 1
  ),
  page as (
    select candidate.*
    from candidates candidate
    order by candidate.created_at desc, candidate.id desc
    limit p_limit
  )
  select
    page.id,
    page.body,
    page.is_heads_up,
    page.created_at,
    page.edited_at,
    author.id,
    author.full_name,
    author.avatar_url,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', mentioned_user.id,
            'full_name', mentioned_user.full_name
          )
          order by mentioned_user.full_name, mentioned_user.id
        )
        from unnest(page.mentioned_user_ids) mentions(mention_id)
        join public.users mentioned_user
          on mentioned_user.id = mentions.mention_id
      ),
      '[]'::jsonb
    ),
    v_event_status <> 'Archived' and page.created_by = v_caller_id,
    v_event_status <> 'Archived'
      and (page.created_by = v_caller_id or v_caller_role = 'Admin'),
    (select count(*) > p_limit from candidates)
  from page
  join public.users author on author.id = page.created_by
  order by page.created_at desc, page.id desc;
end;
$$;

alter function public.list_task_comments(uuid, integer, timestamptz, uuid)
owner to postgres;

revoke all on function public.list_task_comments(uuid, integer, timestamptz, uuid)
from public, anon, authenticated;
grant execute on function public.list_task_comments(uuid, integer, timestamptz, uuid)
to authenticated;

create function public.list_task_comment_mention_candidates(
  p_task_id uuid,
  p_search text default null,
  p_limit integer default 20
)
returns table (
  out_id uuid,
  out_full_name text,
  out_avatar_url text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_search text := public.task_comment_trim_body(p_search);
begin
  if public.task_content_access(p_task_id) <> 'real' then
    raise exception using
      errcode = 'CCC01',
      message = 'The task comments are unavailable.';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 20
     or char_length(v_search) > 100 then
    raise exception using
      errcode = 'CCC02',
      message = 'Mention search is invalid.';
  end if;

  return query
  select
    candidate.id,
    candidate.full_name,
    candidate.avatar_url
  from public.users candidate
  where candidate.is_active is true
    and public.task_content_access_for_user(
      p_task_id,
      candidate.id
    ) = 'real'
    and (
      v_search is null
      or v_search = ''
      or strpos(lower(candidate.full_name), lower(v_search)) > 0
    )
  order by candidate.full_name, candidate.id
  limit p_limit;
end;
$$;

alter function public.list_task_comment_mention_candidates(uuid, text, integer)
owner to postgres;

revoke all on function public.list_task_comment_mention_candidates(uuid, text, integer)
from public, anon, authenticated;
grant execute on function public.list_task_comment_mention_candidates(uuid, text, integer)
to authenticated;

create function public.add_task_comment(
  p_task_id uuid,
  p_body text,
  p_is_heads_up boolean default false,
  p_mentioned_user_ids uuid[] default '{}'::uuid[]
)
returns table (
  out_id uuid,
  out_created_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
  v_event_id uuid;
  v_event_status text;
  v_body text;
  v_mentions uuid[];
  v_affected integer;
begin
  if public.task_content_access(p_task_id) <> 'real' then
    raise exception using errcode = 'CCC01', message = 'The task comments are unavailable.';
  end if;

  select task_row.event_id
  into v_event_id
  from public.tasks task_row
  where task_row.id = p_task_id
  for no key update;

  if not found then
    raise exception using errcode = 'CCC01', message = 'The task comments are unavailable.';
  end if;

  select event_row.status
  into v_event_status
  from public.events event_row
  where event_row.id = v_event_id
  for share;

  if not found or not exists (
    select 1 from public.tasks task_row
    where task_row.id = p_task_id and task_row.event_id = v_event_id
  ) then
    raise exception using errcode = '40001', message = 'The task changed. Refresh and try again.';
  end if;

  if public.task_content_access(p_task_id) <> 'real' then
    raise exception using errcode = 'CCC01', message = 'The task comments are unavailable.';
  end if;

  if v_event_status = 'Archived' then
    raise exception using errcode = 'CCC05', message = 'Archived task comments are read-only.';
  end if;

  v_body := public.task_comment_trim_body(p_body);
  if v_body is null or char_length(v_body) not between 1 and 4000
     or p_is_heads_up is null then
    raise exception using errcode = 'CCC03', message = 'A comment must contain between 1 and 4000 characters.';
  end if;

  v_mentions := public.normalize_task_comment_mentions(p_mentioned_user_ids);
  if not public.task_comment_mentions_are_valid(p_task_id, v_mentions) then
    raise exception using errcode = 'CCC04', message = 'Every mentioned user must be an available active user with full task access.';
  end if;

  insert into public.task_comments (
    task_id,
    created_by,
    body,
    is_heads_up,
    mentioned_user_ids
  )
  values (
    p_task_id,
    v_caller_id,
    v_body,
    p_is_heads_up,
    v_mentions
  )
  returning task_comments.id, task_comments.created_at
  into out_id, out_created_at;

  get diagnostics v_affected = row_count;
  if v_affected <> 1 then
    raise exception using errcode = '40001', message = 'The comment changed. Refresh and try again.';
  end if;

  return next;
end;
$$;

alter function public.add_task_comment(uuid, text, boolean, uuid[])
owner to postgres;

revoke all on function public.add_task_comment(uuid, text, boolean, uuid[])
from public, anon, authenticated;
grant execute on function public.add_task_comment(uuid, text, boolean, uuid[])
to authenticated;

create function public.edit_task_comment(
  p_comment_id uuid,
  p_body text,
  p_is_heads_up boolean,
  p_mentioned_user_ids uuid[],
  p_expected_edited_at timestamptz
)
returns table (
  out_id uuid,
  out_edited_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
  v_task_id uuid;
  v_event_id uuid;
  v_event_status text;
  v_creator_id uuid;
  v_stored_body text;
  v_stored_heads_up boolean;
  v_stored_mentions uuid[];
  v_stored_edited_at timestamptz;
  v_body text;
  v_mentions uuid[];
  v_affected integer;
begin
  select comment_row.task_id
  into v_task_id
  from public.task_comments comment_row
  where comment_row.id = p_comment_id;

  if not found then
    raise exception using errcode = 'CCC01', message = 'The task comments are unavailable.';
  end if;

  if public.task_content_access(v_task_id) <> 'real' then
    raise exception using errcode = 'CCC01', message = 'The task comments are unavailable.';
  end if;

  select task_row.event_id
  into v_event_id
  from public.tasks task_row
  where task_row.id = v_task_id
  for no key update;

  if not found then
    raise exception using errcode = 'CCC01', message = 'The task comments are unavailable.';
  end if;

  select event_row.status
  into v_event_status
  from public.events event_row
  where event_row.id = v_event_id
  for share;

  if not found or not exists (
    select 1 from public.tasks task_row
    where task_row.id = v_task_id and task_row.event_id = v_event_id
  ) then
    raise exception using errcode = '40001', message = 'The task changed. Refresh and try again.';
  end if;

  if public.task_content_access(v_task_id) <> 'real' then
    raise exception using errcode = 'CCC01', message = 'The task comments are unavailable.';
  end if;

  if v_event_status = 'Archived' then
    raise exception using errcode = 'CCC05', message = 'Archived task comments are read-only.';
  end if;

  select
    comment_row.created_by,
    comment_row.body,
    comment_row.is_heads_up,
    comment_row.mentioned_user_ids,
    comment_row.edited_at
  into
    v_creator_id,
    v_stored_body,
    v_stored_heads_up,
    v_stored_mentions,
    v_stored_edited_at
  from public.task_comments comment_row
  where comment_row.id = p_comment_id
    and comment_row.task_id = v_task_id
  for update;

  if not found then
    raise exception using errcode = '40001', message = 'The comment changed. Refresh and try again.';
  end if;

  if v_creator_id is distinct from v_caller_id then
    raise exception using errcode = 'CCC06', message = 'Only the comment author can edit it.';
  end if;

  if v_stored_edited_at is distinct from p_expected_edited_at then
    raise exception using errcode = 'CCC08', message = 'The comment changed. Refresh and try again.';
  end if;

  v_body := public.task_comment_trim_body(p_body);
  if v_body is null or char_length(v_body) not between 1 and 4000
     or p_is_heads_up is null then
    raise exception using errcode = 'CCC03', message = 'A comment must contain between 1 and 4000 characters.';
  end if;

  v_mentions := public.normalize_task_comment_mentions(p_mentioned_user_ids);
  if not public.task_comment_mentions_are_valid(v_task_id, v_mentions) then
    raise exception using errcode = 'CCC04', message = 'Every mentioned user must be an available active user with full task access.';
  end if;

  if (v_body, p_is_heads_up, v_mentions)
     is not distinct from (v_stored_body, v_stored_heads_up, v_stored_mentions) then
    raise exception using errcode = 'CCC09', message = 'Make a change before saving the comment.';
  end if;

  update public.task_comments comment_row
  set
    body = v_body,
    is_heads_up = p_is_heads_up,
    mentioned_user_ids = v_mentions
  where comment_row.id = p_comment_id
    and comment_row.task_id = v_task_id
  returning comment_row.id, comment_row.edited_at
  into out_id, out_edited_at;

  get diagnostics v_affected = row_count;
  if v_affected <> 1 then
    raise exception using errcode = '40001', message = 'The comment changed. Refresh and try again.';
  end if;

  return next;
end;
$$;

alter function public.edit_task_comment(uuid, text, boolean, uuid[], timestamptz)
owner to postgres;

revoke all on function public.edit_task_comment(uuid, text, boolean, uuid[], timestamptz)
from public, anon, authenticated;
grant execute on function public.edit_task_comment(uuid, text, boolean, uuid[], timestamptz)
to authenticated;

create function public.delete_task_comment(p_comment_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_task_id uuid;
  v_event_id uuid;
  v_event_status text;
  v_creator_id uuid;
  v_affected integer;
begin
  select comment_row.task_id
  into v_task_id
  from public.task_comments comment_row
  where comment_row.id = p_comment_id;

  if not found then
    raise exception using errcode = 'CCC01', message = 'The task comments are unavailable.';
  end if;

  if public.task_content_access(v_task_id) <> 'real' then
    raise exception using errcode = 'CCC01', message = 'The task comments are unavailable.';
  end if;

  select task_row.event_id
  into v_event_id
  from public.tasks task_row
  where task_row.id = v_task_id
  for no key update;

  if not found then
    raise exception using errcode = 'CCC01', message = 'The task comments are unavailable.';
  end if;

  select event_row.status
  into v_event_status
  from public.events event_row
  where event_row.id = v_event_id
  for share;

  if not found or not exists (
    select 1 from public.tasks task_row
    where task_row.id = v_task_id and task_row.event_id = v_event_id
  ) then
    raise exception using errcode = '40001', message = 'The task changed. Refresh and try again.';
  end if;

  if public.task_content_access(v_task_id) <> 'real' then
    raise exception using errcode = 'CCC01', message = 'The task comments are unavailable.';
  end if;

  if v_event_status = 'Archived' then
    raise exception using errcode = 'CCC05', message = 'Archived task comments are read-only.';
  end if;

  select user_row.role, comment_row.created_by
  into v_caller_role, v_creator_id
  from public.users user_row
  join public.task_comments comment_row
    on comment_row.id = p_comment_id
   and comment_row.task_id = v_task_id
  where user_row.id = v_caller_id
    and user_row.is_active is true;

  if not found then
    raise exception using errcode = '40001', message = 'The comment changed. Refresh and try again.';
  end if;

  if v_creator_id is distinct from v_caller_id
     and v_caller_role <> 'Admin' then
    raise exception using errcode = 'CCC07', message = 'You cannot delete this comment.';
  end if;

  delete from public.task_comments comment_row
  where comment_row.id = p_comment_id
    and comment_row.task_id = v_task_id;

  get diagnostics v_affected = row_count;
  if v_affected <> 1 then
    raise exception using errcode = '40001', message = 'The comment changed. Refresh and try again.';
  end if;
end;
$$;

alter function public.delete_task_comment(uuid)
owner to postgres;

revoke all on function public.delete_task_comment(uuid)
from public, anon, authenticated;
grant execute on function public.delete_task_comment(uuid)
to authenticated;
