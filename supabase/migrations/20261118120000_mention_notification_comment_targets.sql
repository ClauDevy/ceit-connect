-- Phase 5 follow-up: preserve the exact comment behind mention notifications and
-- expose only fixed, access-aware same-origin task targets to the bell and push.

do $$
declare
  v_replaced_count integer;
  v_dependent_count integer;
begin
  if pg_catalog.to_regprocedure(
       'ceit_connect_private.insert_notifications(text,uuid,uuid,uuid[])'
     ) is null
     or pg_catalog.to_regprocedure(
       'ceit_connect_private.notify_task_comment()'
     ) is null
     or pg_catalog.to_regprocedure(
       'ceit_connect_private.list_notifications_for_user(uuid,integer,timestamptz,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.list_notifications(integer,timestamptz,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.claim_push_deliveries(integer)'
     ) is null then
    raise exception 'Mention targets stopped: a latest notification function is unavailable.';
  end if;

  select pg_catalog.count(*)::integer
  into v_replaced_count
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = procedure.pronamespace
  where (namespace.nspname, procedure.proname) in (
    ('ceit_connect_private', 'insert_notifications'),
    ('ceit_connect_private', 'notify_task_comment'),
    ('ceit_connect_private', 'list_notifications_for_user'),
    ('public', 'list_notifications'),
    ('public', 'claim_push_deliveries')
  );

  if v_replaced_count <> 5 then
    raise exception 'Mention targets stopped: the five replaced functions have unexpected overloads.';
  end if;

  select pg_catalog.count(*)::integer
  into v_dependent_count
  from pg_catalog.pg_depend as dependency
  where dependency.refobjid in (
    'ceit_connect_private.insert_notifications(text,uuid,uuid,uuid[])'::regprocedure,
    'ceit_connect_private.list_notifications_for_user(uuid,integer,timestamptz,uuid)'::regprocedure,
    'public.list_notifications(integer,timestamptz,uuid)'::regprocedure
  )
    and dependency.deptype not in ('i', 'e');

  if v_dependent_count <> 0 then
    raise exception 'Mention targets stopped: a drop-and-recreate function has dependent objects.';
  end if;
end
$$;

alter table public.notifications
add column comment_id uuid;

alter table public.notifications
add constraint notifications_comment_id_fkey
foreign key (comment_id)
references public.task_comments(id)
on delete set null;

alter table public.notifications
add constraint notifications_comment_id_type_check
check (comment_id is null or type = 'mention');

create index notifications_comment_id_idx
on public.notifications(comment_id)
where comment_id is not null;

drop function public.list_notifications(integer, timestamptz, uuid);
drop function ceit_connect_private.list_notifications_for_user(
  uuid, integer, timestamptz, uuid
);
drop function ceit_connect_private.insert_notifications(text, uuid, uuid, uuid[]);

create function ceit_connect_private.insert_notifications(
  p_type text,
  p_task_id uuid,
  p_actor_id uuid,
  p_recipient_ids uuid[],
  p_comment_id uuid default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_inserted integer;
begin
  if p_type not in (
    'mention', 'heads_up', 'assignment', 'status_change', 'unlock', 'backup_request',
    'volunteer_offer', 'leave_requested', 'leave_cancelled', 'leave_approved', 'leave_denied',
    'task_due_soon', 'live_operation_prep'
  ) or p_task_id is null then
    raise exception 'Notification metadata is invalid.';
  end if;

  if p_comment_id is not null
     and (
       p_type <> 'mention'
       or not exists (
         select 1
         from public.task_comments as comment_row
         where comment_row.id = p_comment_id
           and comment_row.task_id = p_task_id
       )
     ) then
    raise exception 'Notification metadata is invalid.';
  end if;

  insert into public.notifications (user_id, type, task_id, comment_id)
  select recipient.user_id, p_type, p_task_id, p_comment_id
  from (
    select distinct proposed.user_id
    from pg_catalog.unnest(coalesce(p_recipient_ids, '{}'::uuid[]))
      as proposed(user_id)
    where proposed.user_id is not null
      and proposed.user_id is distinct from p_actor_id
  ) as recipient
  join public.users as profile
    on profile.id = recipient.user_id
   and profile.is_active is true;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

alter function ceit_connect_private.insert_notifications(
  text, uuid, uuid, uuid[], uuid
) owner to postgres;
revoke all on function ceit_connect_private.insert_notifications(
  text, uuid, uuid, uuid[], uuid
) from public, anon, authenticated, service_role;

create or replace function ceit_connect_private.notify_task_comment()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_event_status text;
  v_mention_ids uuid[] := '{}'::uuid[];
  v_heads_up_ids uuid[] := '{}'::uuid[];
begin
  select event_row.status
  into v_event_status
  from public.tasks as task_row
  join public.events as event_row on event_row.id = task_row.event_id
  where task_row.id = new.task_id;

  if v_event_status is distinct from 'Active' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_mention_ids := new.mentioned_user_ids;
  else
    select coalesce(pg_catalog.array_agg(candidate.user_id order by candidate.user_id), '{}'::uuid[])
    into v_mention_ids
    from (
      select distinct proposed.user_id
      from pg_catalog.unnest(new.mentioned_user_ids) as proposed(user_id)
      except
      select distinct previous.user_id
      from pg_catalog.unnest(old.mentioned_user_ids) as previous(user_id)
    ) as candidate;
  end if;

  if pg_catalog.cardinality(v_mention_ids) > 0 then
    perform ceit_connect_private.insert_notifications(
      'mention', new.task_id, new.created_by, v_mention_ids, new.id
    );
  end if;

  if new.is_heads_up is true
     and (tg_op = 'INSERT' or old.is_heads_up is distinct from true) then
    select coalesce(pg_catalog.array_agg(candidate.user_id order by candidate.user_id), '{}'::uuid[])
    into v_heads_up_ids
    from (
      select distinct proposed.user_id
      from public.tasks as task_row
      cross join lateral pg_catalog.unnest(
        task_row.primary_assignees || task_row.assist_assignees
      ) as proposed(user_id)
      where task_row.id = new.task_id
        and not proposed.user_id = any(new.mentioned_user_ids)
    ) as candidate;

    perform ceit_connect_private.insert_notifications(
      'heads_up', new.task_id, new.created_by, v_heads_up_ids
    );
  end if;

  return new;
end;
$$;

alter function ceit_connect_private.notify_task_comment() owner to postgres;
revoke all on function ceit_connect_private.notify_task_comment()
from public, anon, authenticated, service_role;

create function ceit_connect_private.list_notifications_for_user(
  p_user_id uuid,
  p_limit integer,
  p_before_created_at timestamptz,
  p_before_id uuid
)
returns table (
  out_id uuid,
  out_type text,
  out_task_id uuid,
  out_comment_id uuid,
  out_task_title text,
  out_read_at timestamptz,
  out_created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with notification_page as materialized (
    select notification_row.id,
           notification_row.type,
           notification_row.task_id,
           notification_row.comment_id,
           task_row.title as stored_task_title,
           notification_row.read_at,
           notification_row.created_at,
           public.task_content_access_for_user(
             notification_row.task_id,
             p_user_id
           ) as content_access
    from public.notifications as notification_row
    join public.tasks as task_row on task_row.id = notification_row.task_id
    where notification_row.user_id = p_user_id
      and (
        p_before_created_at is null
        or (notification_row.created_at, notification_row.id)
           < (p_before_created_at, p_before_id)
      )
    order by notification_row.created_at desc, notification_row.id desc
    limit p_limit
  )
  select notification_row.id,
         notification_row.type,
         case
           when notification_row.content_access = 'hidden' then null::uuid
           else notification_row.task_id
         end,
         case
           when notification_row.type = 'mention'
            and notification_row.content_access = 'real'
            and exists (
              select 1
              from public.task_comments as comment_row
              where comment_row.id = notification_row.comment_id
                and comment_row.task_id = notification_row.task_id
            ) then notification_row.comment_id
           else null::uuid
         end,
         case
           when notification_row.content_access = 'real'
             then notification_row.stored_task_title
           else 'Confidential Task'
         end,
         notification_row.read_at,
         notification_row.created_at
  from notification_page as notification_row
  order by notification_row.created_at desc, notification_row.id desc
$$;

alter function ceit_connect_private.list_notifications_for_user(
  uuid, integer, timestamptz, uuid
) owner to postgres;
revoke all on function ceit_connect_private.list_notifications_for_user(
  uuid, integer, timestamptz, uuid
) from public, anon, authenticated, service_role;

create function public.list_notifications(
  p_limit integer default 21,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  out_id uuid,
  out_type text,
  out_task_id uuid,
  out_comment_id uuid,
  out_task_title text,
  out_read_at timestamptz,
  out_created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
begin
  if not exists (
    select 1
    from public.users as profile
    where profile.id = v_caller_id
      and profile.is_active is true
  ) then
    raise exception using errcode = '42501', message = 'An active profile is required.';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception using errcode = '22023', message = 'Notification page size is invalid.';
  end if;
  if (p_before_created_at is null) is distinct from (p_before_id is null) then
    raise exception using errcode = '22023', message = 'Notification cursor is invalid.';
  end if;

  return query
  select private_row.out_id,
         private_row.out_type,
         private_row.out_task_id,
         private_row.out_comment_id,
         private_row.out_task_title,
         private_row.out_read_at,
         private_row.out_created_at
  from ceit_connect_private.list_notifications_for_user(
    v_caller_id,
    p_limit,
    p_before_created_at,
    p_before_id
  ) as private_row;
end;
$$;

alter function public.list_notifications(integer, timestamptz, uuid)
owner to postgres;
revoke all on function public.list_notifications(integer, timestamptz, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.list_notifications(integer, timestamptz, uuid)
to authenticated;

create function public.get_task_comment_target_page_anchor(
  p_task_id uuid,
  p_comment_id uuid,
  p_page_size integer default 25
)
returns table (
  out_before_created_at timestamptz,
  out_before_id uuid,
  out_has_newer boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
  v_target_rank bigint;
  v_page_start bigint;
begin
  if p_task_id is null
     or p_comment_id is null
     or p_page_size is null
     or p_page_size < 1
     or p_page_size > 50
     or not exists (
       select 1
       from public.users as profile
       where profile.id = v_caller_id
         and profile.is_active is true
     )
     or public.task_content_access_for_user(p_task_id, v_caller_id) <> 'real' then
    raise exception using
      errcode = 'CCC01',
      message = 'The target comment is unavailable.';
  end if;

  select ordered.comment_rank
  into v_target_rank
  from (
    select comment_row.id,
           pg_catalog.row_number() over (
             order by comment_row.created_at desc, comment_row.id desc
           ) as comment_rank
    from public.task_comments as comment_row
    where comment_row.task_id = p_task_id
  ) as ordered
  where ordered.id = p_comment_id;

  if v_target_rank is null then
    raise exception using
      errcode = 'CCC01',
      message = 'The target comment is unavailable.';
  end if;

  v_page_start := ((v_target_rank - 1) / p_page_size) * p_page_size + 1;

  if v_page_start = 1 then
    out_before_created_at := null;
    out_before_id := null;
    out_has_newer := false;
  else
    select ordered.created_at, ordered.id
    into out_before_created_at, out_before_id
    from (
      select comment_row.id,
             comment_row.created_at,
             pg_catalog.row_number() over (
               order by comment_row.created_at desc, comment_row.id desc
             ) as comment_rank
      from public.task_comments as comment_row
      where comment_row.task_id = p_task_id
    ) as ordered
    where ordered.comment_rank = v_page_start - 1;

    if out_before_id is null then
      raise exception using
        errcode = 'CCC01',
        message = 'The target comment is unavailable.';
    end if;
    out_has_newer := true;
  end if;

  return next;
end;
$$;

alter function public.get_task_comment_target_page_anchor(uuid, uuid, integer)
owner to postgres;
revoke all on function public.get_task_comment_target_page_anchor(uuid, uuid, integer)
from public, anon, authenticated, service_role;
grant execute on function public.get_task_comment_target_page_anchor(uuid, uuid, integer)
to authenticated;

create or replace function public.claim_push_deliveries(p_limit integer default 50)
returns table (
  out_delivery_id uuid,
  out_lease_token uuid,
  out_run_id uuid,
  out_run_token uuid,
  out_endpoint text,
  out_p256dh text,
  out_auth_secret text,
  out_title text,
  out_body text,
  out_target_path text,
  out_notification_type text,
  out_attempt integer,
  out_lease_expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_generation bigint;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_run_id uuid := gen_random_uuid();
  v_run_token uuid := gen_random_uuid();
  v_claimed integer;
begin
  v_generation := ceit_connect_private.authenticate_push_sender();
  if v_generation is null then
    raise exception using errcode = '42501', message = 'Push sender authentication failed.';
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'Claim limit must be between 1 and 100.';
  end if;

  delete from ceit_connect_private.push_delivery_queue as queue
  where not exists (
    select 1
    from public.notifications as notification
    join public.push_subscriptions as subscription
      on subscription.id = queue.subscription_id
     and subscription.user_id = queue.user_id
    join public.users as profile
      on profile.id = queue.user_id and profile.is_active
    where notification.id = queue.notification_id
  );

  update ceit_connect_private.push_delivery_queue as queue
  set state = case
        when queue.attempt_count >= 8 then 'terminal'
        when queue.retry_deadline_at <= v_now then 'terminal'
        else 'pending'
      end,
      terminal_at = case
        when queue.attempt_count >= 8 or queue.retry_deadline_at <= v_now then v_now else null
      end,
      terminal_reason = case
        when queue.attempt_count >= 8 then 'attempts_exhausted'
        when queue.retry_deadline_at <= v_now then 'retry_window_exhausted'
        else null
      end,
      next_attempt_at = case
        when queue.attempt_count < 8 and queue.retry_deadline_at > v_now then v_now
        else queue.next_attempt_at
      end,
      lease_token = null,
      lease_expires_at = null,
      updated_at = v_now
  where queue.state = 'leased' and queue.lease_expires_at <= v_now;

  insert into ceit_connect_private.push_delivery_runs(
    id, run_token, started_at
  ) values (
    v_run_id, v_run_token, v_now
  );

  return query
  with candidates as materialized (
    select queue.id
    from ceit_connect_private.push_delivery_queue as queue
    join public.notifications as notification
      on notification.id = queue.notification_id
    join public.push_subscriptions as subscription
      on subscription.id = queue.subscription_id
     and subscription.user_id = queue.user_id
    join public.users as profile
      on profile.id = queue.user_id and profile.is_active
    where queue.state = 'pending'
      and queue.next_attempt_at <= v_now
      and queue.retry_deadline_at > v_now
      and queue.attempt_count < 8
      and (subscription.expires_at is null or subscription.expires_at > v_now)
    order by queue.next_attempt_at, queue.created_at, queue.id
    limit p_limit
    for update of queue skip locked
  ), leased as (
    update ceit_connect_private.push_delivery_queue as queue
    set state = 'leased',
        attempt_count = queue.attempt_count + 1,
        lease_token = gen_random_uuid(),
        lease_expires_at = v_now + interval '2 minutes',
        run_id = v_run_id,
        updated_at = v_now
    from candidates
    where queue.id = candidates.id
    returning queue.*
  )
  select leased.id,
         leased.lease_token,
         v_run_id,
         v_run_token,
         subscription.endpoint,
         subscription.p256dh,
         subscription.auth_secret,
         'CEIT Connect'::text,
         case leased.notification_type
           when 'mention' then 'You were mentioned in a task.'
           when 'heads_up' then 'A task you’re assigned to has a new heads-up.'
           when 'assignment' then 'You were assigned to a task.'
           when 'status_change' then 'A task you’re assigned to changed status.'
           when 'unlock' then 'A task you’re assigned to is now unlocked.'
           when 'backup_request' then 'A task needs backup help.'
           when 'volunteer_offer' then 'A task has a new volunteer offer.'
           when 'leave_requested' then 'A task has a new leave request.'
           when 'leave_cancelled' then 'A leave request was cancelled.'
           when 'leave_approved' then 'Your leave request was approved.'
           when 'leave_denied' then 'Your leave request was denied.'
           when 'task_due_soon' then 'A task is due soon.'
           when 'live_operation_prep' then 'A Live Operation call time is soon.'
         end,
         case
           when target_access.content_access = 'hidden'
             or notification.task_id is null then '/'
           when leased.notification_type = 'mention'
            and notification.comment_id is not null
            and target_access.content_access = 'real'
            and exists (
              select 1
              from public.task_comments as comment_row
              where comment_row.id = notification.comment_id
                and comment_row.task_id = notification.task_id
            ) then pg_catalog.format(
              '/tasks/%s#comment-%s', notification.task_id, notification.comment_id
            )
           else pg_catalog.format('/tasks/%s', notification.task_id)
         end,
         leased.notification_type,
         leased.attempt_count,
         leased.lease_expires_at
  from leased
  join public.push_subscriptions as subscription
    on subscription.id = leased.subscription_id
  join public.notifications as notification
    on notification.id = leased.notification_id
  cross join lateral (
    select public.task_content_access_for_user(
      notification.task_id,
      leased.user_id
    ) as content_access
  ) as target_access;

  get diagnostics v_claimed = row_count;
  if v_claimed = 0 then
    delete from ceit_connect_private.push_delivery_runs as run_row
    where run_row.id = v_run_id;
  else
    update ceit_connect_private.push_delivery_runs as run_row
    set claimed_count = v_claimed
    where run_row.id = v_run_id;
  end if;
end;
$$;

alter function public.claim_push_deliveries(integer) owner to postgres;
revoke all on function public.claim_push_deliveries(integer)
from public, anon, authenticated, service_role;
grant execute on function public.claim_push_deliveries(integer) to anon;

do $$
declare
  v_replaced_count integer;
begin
  select pg_catalog.count(*)::integer
  into v_replaced_count
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = procedure.pronamespace
  where (namespace.nspname, procedure.proname) in (
    ('ceit_connect_private', 'insert_notifications'),
    ('ceit_connect_private', 'notify_task_comment'),
    ('ceit_connect_private', 'list_notifications_for_user'),
    ('public', 'list_notifications'),
    ('public', 'claim_push_deliveries')
  );

  if v_replaced_count <> 5
     or pg_catalog.to_regprocedure(
       'ceit_connect_private.insert_notifications(text,uuid,uuid,uuid[],uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.get_task_comment_target_page_anchor(uuid,uuid,integer)'
     ) is null then
    raise exception 'Mention targets stopped: the final function inventory is invalid.';
  end if;
end
$$;

comment on column public.notifications.comment_id is
  'Nullable exact comment target for mention notifications. ON DELETE SET NULL preserves safe task-only fallback.';
comment on function public.get_task_comment_target_page_anchor(uuid, uuid, integer) is
  'Returns only the exact keyset cursor before the bounded newest-first page containing an authorized target comment.';
