create table ceit_connect_private.push_launch_group_context (
  transaction_id xid8 primary key
);

alter table ceit_connect_private.push_launch_group_context owner to postgres;
alter table ceit_connect_private.push_launch_group_context enable row level security;
revoke all on table ceit_connect_private.push_launch_group_context
from public, anon, authenticated, service_role;

alter table ceit_connect_private.push_delivery_queue
add column group_window_id uuid,
add column group_window_started_at timestamptz;

alter table ceit_connect_private.push_delivery_queue
add constraint push_delivery_queue_group_shape check (
  (
    group_window_id is null
    and group_window_started_at is null
  )
  or (
    group_window_id is not null
    and group_window_started_at is not null
    and notification_type in (
      'assignment', 'task_due_soon', 'live_operation_prep', 'unlock'
    )
  )
);

alter table ceit_connect_private.push_delivery_queue
drop constraint push_delivery_queue_terminal_reason_check;

alter table ceit_connect_private.push_delivery_queue
add constraint push_delivery_queue_terminal_reason_check check (
  terminal_reason in (
    'permanent_failure',
    'retry_window_exhausted',
    'attempts_exhausted',
    'all_read'
  )
);

create index push_delivery_queue_open_group_idx
on ceit_connect_private.push_delivery_queue (
  user_id,
  notification_type,
  group_window_started_at,
  id
)
where state = 'pending'
  and attempt_count = 0
  and group_window_id is not null;

create index push_delivery_queue_group_subscription_idx
on ceit_connect_private.push_delivery_queue (
  group_window_id,
  subscription_id,
  created_at,
  id
)
where group_window_id is not null;

create or replace function ceit_connect_private.notify_event_launch()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_transaction_id xid8;
begin
  if old.status = 'Draft' and new.status = 'Active' then
    v_transaction_id := pg_catalog.pg_current_xact_id();

    insert into ceit_connect_private.push_launch_group_context (
      transaction_id
    ) values (
      v_transaction_id
    );

    begin
      insert into public.notifications (user_id, type, task_id)
      select distinct recipient.user_id, 'assignment', task_row.id
      from public.tasks as task_row
      cross join lateral pg_catalog.unnest(
        task_row.primary_assignees || task_row.assist_assignees
      ) as recipient(user_id)
      join public.users as profile
        on profile.id = recipient.user_id
       and profile.is_active is true
      where task_row.event_id = new.id
        and recipient.user_id is distinct from v_actor_id;
    exception
      when others then
        delete from ceit_connect_private.push_launch_group_context
        where transaction_id = v_transaction_id;
        raise;
    end;

    delete from ceit_connect_private.push_launch_group_context
    where transaction_id = v_transaction_id;
  end if;

  return new;
end;
$$;

alter function ceit_connect_private.notify_event_launch() owner to postgres;
revoke all on function ceit_connect_private.notify_event_launch()
from public, anon, authenticated, service_role;

create or replace function ceit_connect_private.enqueue_notification_push()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_group_window_id uuid;
  v_group_window_started_at timestamptz;
  v_grouped boolean := false;
  v_inserted integer := 0;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  begin
    if tg_op <> 'INSERT'
       or tg_level <> 'ROW'
       or tg_table_schema <> 'public'
       or tg_table_name <> 'notifications' then
      return new;
    end if;

    v_grouped :=
      new.type in ('task_due_soon', 'live_operation_prep', 'unlock')
      or (
        new.type = 'assignment'
        and exists (
          select 1
          from ceit_connect_private.push_launch_group_context as context_row
          where context_row.transaction_id = pg_catalog.pg_current_xact_id()
        )
      );

    if v_grouped then
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
          pg_catalog.concat_ws(
            ':',
            'push-group',
            new.user_id::text,
            new.type
          ),
          524119221
        )
      );

      v_now := pg_catalog.clock_timestamp();

      select
        queue.group_window_id,
        queue.group_window_started_at
      into
        v_group_window_id,
        v_group_window_started_at
      from ceit_connect_private.push_delivery_queue as queue
      where queue.user_id = new.user_id
        and queue.notification_type = new.type
        and queue.state = 'pending'
        and queue.attempt_count = 0
        and queue.group_window_id is not null
        and queue.group_window_started_at + interval '25 seconds' > v_now
      order by queue.group_window_started_at, queue.id
      limit 1;

      if not found then
        v_group_window_id := gen_random_uuid();
        v_group_window_started_at := v_now;
      end if;
    end if;

    insert into ceit_connect_private.push_delivery_queue (
      notification_id,
      user_id,
      subscription_id,
      notification_type,
      group_window_id,
      group_window_started_at,
      next_attempt_at,
      retry_deadline_at
    )
    select
      new.id,
      new.user_id,
      subscription.id,
      new.type,
      v_group_window_id,
      v_group_window_started_at,
      case
        when v_grouped
          then v_group_window_started_at + interval '30 seconds'
        else v_now
      end,
      case
        when v_grouped
          then v_group_window_started_at + interval '1 hour'
        else v_now + interval '1 hour'
      end
    from public.push_subscriptions as subscription
    join public.users as profile
      on profile.id = subscription.user_id
     and profile.is_active
    where subscription.user_id = new.user_id
      and (
        subscription.expires_at is null
        or subscription.expires_at > v_now
      )
    on conflict (notification_id, subscription_id) do nothing;

    get diagnostics v_inserted = row_count;
  exception
    when others then
      return new;
  end;

  if v_inserted > 0 then
    begin
      perform ceit_connect_private.request_push_kick(false);
    exception
      when others then
        null;
    end;
  end if;

  return new;
end;
$$;

alter function ceit_connect_private.enqueue_notification_push()
owner to postgres;
revoke all on function ceit_connect_private.enqueue_notification_push()
from public, anon, authenticated, service_role;

create or replace function public.claim_push_deliveries(
  p_limit integer default 50
)
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
    raise exception using
      errcode = '42501',
      message = 'Push sender authentication failed.';
  end if;

  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using
      errcode = '22023',
      message = 'Claim limit must be between 1 and 100.';
  end if;

  delete from ceit_connect_private.push_delivery_queue as queue
  where not exists (
    select 1
    from public.notifications as notification
    join public.push_subscriptions as subscription
      on subscription.id = queue.subscription_id
     and subscription.user_id = queue.user_id
    join public.users as profile
      on profile.id = queue.user_id
     and profile.is_active
    where notification.id = queue.notification_id
  );

  update ceit_connect_private.push_delivery_queue as queue
  set state = case
        when queue.attempt_count >= 8 then 'terminal'
        when queue.retry_deadline_at <= v_now then 'terminal'
        else 'pending'
      end,
      terminal_at = case
        when queue.attempt_count >= 8
          or queue.retry_deadline_at <= v_now
          then v_now
        else null
      end,
      terminal_reason = case
        when queue.attempt_count >= 8 then 'attempts_exhausted'
        when queue.retry_deadline_at <= v_now
          then 'retry_window_exhausted'
        else null
      end,
      next_attempt_at = case
        when queue.attempt_count < 8
          and queue.retry_deadline_at > v_now
          then v_now
        else queue.next_attempt_at
      end,
      lease_token = null,
      lease_expires_at = null,
      updated_at = v_now
  where queue.state = 'leased'
    and queue.lease_expires_at <= v_now;

  with all_read_groups as materialized (
    select distinct queue.group_window_id
    from ceit_connect_private.push_delivery_queue as queue
    where queue.group_window_id is not null
      and queue.state = 'pending'
      and queue.group_window_started_at + interval '30 seconds' <= v_now
      and not exists (
        select 1
        from ceit_connect_private.push_delivery_queue as member
        join public.notifications as notification
          on notification.id = member.notification_id
        where member.group_window_id = queue.group_window_id
          and notification.read_at is null
      )
  )
  update ceit_connect_private.push_delivery_queue as queue
  set state = 'terminal',
      terminal_at = v_now,
      terminal_reason = 'all_read',
      lease_token = null,
      lease_expires_at = null,
      updated_at = v_now
  from all_read_groups
  where queue.group_window_id = all_read_groups.group_window_id
    and queue.state = 'pending';

  insert into ceit_connect_private.push_delivery_runs (
    id,
    run_token,
    started_at
  ) values (
    v_run_id,
    v_run_token,
    v_now
  );

  return query
  with candidates as materialized (
    select
      queue.id as leader_id,
      queue.group_window_id,
      queue.subscription_id,
      gen_random_uuid() as lease_token
    from ceit_connect_private.push_delivery_queue as queue
    join public.notifications as notification
      on notification.id = queue.notification_id
    join public.push_subscriptions as subscription
      on subscription.id = queue.subscription_id
     and subscription.user_id = queue.user_id
    join public.users as profile
      on profile.id = queue.user_id
     and profile.is_active
    where queue.state = 'pending'
      and queue.next_attempt_at <= v_now
      and queue.retry_deadline_at > v_now
      and queue.attempt_count < 8
      and (
        subscription.expires_at is null
        or subscription.expires_at > v_now
      )
      and (
        queue.group_window_id is null
        or not exists (
          select 1
          from ceit_connect_private.push_delivery_queue as earlier
          where earlier.group_window_id = queue.group_window_id
            and earlier.subscription_id = queue.subscription_id
            and earlier.state = 'pending'
            and (
              earlier.created_at,
              earlier.id
            ) < (
              queue.created_at,
              queue.id
            )
        )
      )
    order by queue.next_attempt_at, queue.created_at, queue.id
    limit p_limit
    for update of queue skip locked
  ),
  candidate_members as materialized (
    select
      member.id,
      candidate.leader_id,
      candidate.lease_token
    from candidates as candidate
    join ceit_connect_private.push_delivery_queue as member
      on member.id = candidate.leader_id
      or (
        candidate.group_window_id is not null
        and member.group_window_id = candidate.group_window_id
        and member.subscription_id = candidate.subscription_id
      )
    where member.state = 'pending'
      and member.next_attempt_at <= v_now
      and member.retry_deadline_at > v_now
      and member.attempt_count < 8
  ),
  leased as (
    update ceit_connect_private.push_delivery_queue as queue
    set state = 'leased',
        attempt_count = queue.attempt_count + 1,
        lease_token = candidate_member.lease_token,
        lease_expires_at = v_now + interval '2 minutes',
        run_id = v_run_id,
        updated_at = v_now
    from candidate_members as candidate_member
    where queue.id = candidate_member.id
    returning queue.*, candidate_member.leader_id
  ),
  deliveries as materialized (
    select
      leased.leader_id,
      leased.group_window_id,
      leased.subscription_id,
      leased.lease_token,
      pg_catalog.count(*)::integer as group_count
    from leased
    group by
      leased.leader_id,
      leased.group_window_id,
      leased.subscription_id,
      leased.lease_token
  )
  select
    case
      when delivery.group_count >= 2
        then delivery.group_window_id
      else leader.id
    end,
    delivery.lease_token,
    v_run_id,
    v_run_token,
    subscription.endpoint,
    subscription.p256dh,
    subscription.auth_secret,
    'CEIT Connect'::text,
    case
      when delivery.group_window_id is not null
       and delivery.group_count >= 2 then
        case
          when leader.notification_type = 'assignment' then pg_catalog.format(
            'You were assigned to %s tasks.',
            delivery.group_count
          )
          when leader.notification_type = 'task_due_soon' then pg_catalog.format(
            '%s tasks are due within 24 hours.',
            delivery.group_count
          )
          when leader.notification_type = 'live_operation_prep' then pg_catalog.format(
            '%s Live Operation call times are within 2 hours.',
            delivery.group_count
          )
          when leader.notification_type = 'unlock' then pg_catalog.format(
            '%s of your tasks are now unlocked.',
            delivery.group_count
          )
        end
      else
        case leader.notification_type
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
        end
    end,
    case
      when delivery.group_window_id is not null
       and delivery.group_count >= 2 then '/'
      when target_access.content_access = 'hidden'
        or notification.task_id is null then '/'
      when leader.notification_type = 'mention'
       and notification.comment_id is not null
       and target_access.content_access = 'real'
       and exists (
         select 1
         from public.task_comments as comment_row
         where comment_row.id = notification.comment_id
           and comment_row.task_id = notification.task_id
       ) then pg_catalog.format(
         '/tasks/%s#comment-%s',
         notification.task_id,
         notification.comment_id
       )
      else pg_catalog.format('/tasks/%s', notification.task_id)
    end,
    leader.notification_type,
    leader.attempt_count,
    leader.lease_expires_at
  from deliveries as delivery
  join leased as leader
    on leader.id = delivery.leader_id
  join public.push_subscriptions as subscription
    on subscription.id = delivery.subscription_id
  join public.notifications as notification
    on notification.id = leader.notification_id
  cross join lateral (
    select public.task_content_access_for_user(
      notification.task_id,
      leader.user_id
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

create or replace function public.acknowledge_push_delivery(
  p_delivery_id uuid,
  p_lease_token uuid,
  p_outcome text,
  p_http_status integer default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_generation bigint;
  v_queue ceit_connect_private.push_delivery_queue%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_delay interval;
begin
  v_generation := ceit_connect_private.authenticate_push_sender();

  if v_generation is null then
    raise exception using
      errcode = '42501',
      message = 'Push sender authentication failed.';
  end if;

  select queue.*
  into v_queue
  from ceit_connect_private.push_delivery_queue as queue
  where queue.state = 'leased'
    and queue.lease_token = p_lease_token
    and (
      queue.id = p_delivery_id
      or queue.group_window_id = p_delivery_id
    )
  order by queue.id
  limit 1
  for update;

  if not found then
    return false;
  end if;

  if p_outcome = 'success'
     and p_http_status between 200 and 299 then
    update ceit_connect_private.push_delivery_queue as queue
    set state = 'delivered',
        delivered_at = v_now,
        lease_token = null,
        lease_expires_at = null,
        updated_at = v_now
    where queue.state = 'leased'
      and queue.lease_token = p_lease_token
      and (
        (
          v_queue.group_window_id is null
          and queue.id = v_queue.id
        )
        or (
          v_queue.group_window_id is not null
          and queue.group_window_id = v_queue.group_window_id
          and queue.subscription_id = v_queue.subscription_id
        )
      );

    update ceit_connect_private.push_delivery_runs
    set delivered_count = delivered_count + 1
    where id = v_queue.run_id;

    return true;
  end if;

  if p_outcome = 'gone'
     and p_http_status in (404, 410) then
    update ceit_connect_private.push_delivery_runs
    set expired_subscription_count = expired_subscription_count + 1
    where id = v_queue.run_id;

    perform ceit_connect_private.delete_push_subscription(
      v_queue.subscription_id
    );

    return true;
  end if;

  if p_outcome = 'transient'
     and (
       p_http_status is null
       or p_http_status in (408, 425, 429)
       or p_http_status between 500 and 599
     ) then
    v_delay := case v_queue.attempt_count
      when 1 then interval '30 seconds'
      when 2 then interval '1 minute'
      when 3 then interval '2 minutes'
      when 4 then interval '5 minutes'
      when 5 then interval '10 minutes'
      when 6 then interval '15 minutes'
      else interval '20 minutes'
    end;

    if v_queue.attempt_count >= 8 then
      update ceit_connect_private.push_delivery_queue as queue
      set state = 'terminal',
          terminal_at = v_now,
          terminal_reason = 'attempts_exhausted',
          lease_token = null,
          lease_expires_at = null,
          updated_at = v_now
      where queue.state = 'leased'
        and queue.lease_token = p_lease_token
        and (
          (
            v_queue.group_window_id is null
            and queue.id = v_queue.id
          )
          or (
            v_queue.group_window_id is not null
            and queue.group_window_id = v_queue.group_window_id
            and queue.subscription_id = v_queue.subscription_id
          )
        );

      update ceit_connect_private.push_delivery_runs
      set terminal_count = terminal_count + 1
      where id = v_queue.run_id;
    elsif v_now + v_delay > v_queue.retry_deadline_at then
      update ceit_connect_private.push_delivery_queue as queue
      set state = 'terminal',
          terminal_at = v_now,
          terminal_reason = 'retry_window_exhausted',
          lease_token = null,
          lease_expires_at = null,
          updated_at = v_now
      where queue.state = 'leased'
        and queue.lease_token = p_lease_token
        and (
          (
            v_queue.group_window_id is null
            and queue.id = v_queue.id
          )
          or (
            v_queue.group_window_id is not null
            and queue.group_window_id = v_queue.group_window_id
            and queue.subscription_id = v_queue.subscription_id
          )
        );

      update ceit_connect_private.push_delivery_runs
      set terminal_count = terminal_count + 1
      where id = v_queue.run_id;
    else
      update ceit_connect_private.push_delivery_queue as queue
      set state = 'pending',
          next_attempt_at = v_now + v_delay,
          lease_token = null,
          lease_expires_at = null,
          updated_at = v_now
      where queue.state = 'leased'
        and queue.lease_token = p_lease_token
        and (
          (
            v_queue.group_window_id is null
            and queue.id = v_queue.id
          )
          or (
            v_queue.group_window_id is not null
            and queue.group_window_id = v_queue.group_window_id
            and queue.subscription_id = v_queue.subscription_id
          )
        );

      update ceit_connect_private.push_delivery_runs
      set retry_scheduled_count = retry_scheduled_count + 1
      where id = v_queue.run_id;
    end if;

    return true;
  end if;

  if p_outcome = 'permanent'
     and p_http_status between 400 and 499
     and p_http_status not in (404, 408, 410, 425, 429) then
    update ceit_connect_private.push_delivery_queue as queue
    set state = 'terminal',
        terminal_at = v_now,
        terminal_reason = 'permanent_failure',
        lease_token = null,
        lease_expires_at = null,
        updated_at = v_now
    where queue.state = 'leased'
      and queue.lease_token = p_lease_token
      and (
        (
          v_queue.group_window_id is null
          and queue.id = v_queue.id
        )
        or (
          v_queue.group_window_id is not null
          and queue.group_window_id = v_queue.group_window_id
          and queue.subscription_id = v_queue.subscription_id
        )
      );

    update ceit_connect_private.push_delivery_runs
    set terminal_count = terminal_count + 1
    where id = v_queue.run_id;

    return true;
  end if;

  raise exception using
    errcode = '22023',
    message = 'Delivery outcome is invalid.';
end;
$$;

alter function public.acknowledge_push_delivery(
  uuid,
  uuid,
  text,
  integer
) owner to postgres;
revoke all on function public.acknowledge_push_delivery(
  uuid,
  uuid,
  text,
  integer
) from public, anon, authenticated, service_role;
grant execute on function public.acknowledge_push_delivery(
  uuid,
  uuid,
  text,
  integer
) to anon;
