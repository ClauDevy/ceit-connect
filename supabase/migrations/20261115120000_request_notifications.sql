-- Phase 5 R1: request notifications.
-- Extends the N1 source of truth to volunteer offers and leave-request events
-- without changing the authoritative request/offer writers or their lock order.

do $$
declare
  v_notification_constraint text;
  v_queue_constraint text;
  v_new_type_count integer;
begin
  if current_user <> 'postgres' then
    raise exception 'R1 must be applied by postgres; current_user is %.', current_user;
  end if;

  select pg_catalog.pg_get_constraintdef(constraint_row.oid)
  into v_notification_constraint
  from pg_catalog.pg_constraint as constraint_row
  where constraint_row.conrelid = 'public.notifications'::regclass
    and constraint_row.conname = 'notifications_type_check'
    and constraint_row.contype = 'c';
  if v_notification_constraint is null
     or pg_catalog.strpos(v_notification_constraint, '''mention''') = 0
     or pg_catalog.strpos(v_notification_constraint, '''heads_up''') = 0
     or pg_catalog.strpos(v_notification_constraint, '''assignment''') = 0
     or pg_catalog.strpos(v_notification_constraint, '''status_change''') = 0
     or pg_catalog.strpos(v_notification_constraint, '''unlock''') = 0
     or pg_catalog.strpos(v_notification_constraint, '''backup_request''') = 0 then
    raise exception 'R1 stopped: notifications_type_check differs from the latest N1 definition.';
  end if;
  select count(*)
  into v_new_type_count
  from pg_catalog.unnest(array[
    'volunteer_offer', 'leave_requested', 'leave_cancelled', 'leave_approved', 'leave_denied'
  ]) as proposed(type_name)
  where pg_catalog.strpos(v_notification_constraint, pg_catalog.quote_literal(proposed.type_name)) > 0;
  if v_new_type_count not in (0, 5) then
    raise exception 'R1 stopped: notifications_type_check contains a partial R1 type set.';
  end if;

  select pg_catalog.pg_get_constraintdef(constraint_row.oid)
  into v_queue_constraint
  from pg_catalog.pg_constraint as constraint_row
  where constraint_row.conrelid = 'ceit_connect_private.push_delivery_queue'::regclass
    and constraint_row.conname = 'push_delivery_queue_notification_type_check'
    and constraint_row.contype = 'c';
  if v_queue_constraint is null
     or pg_catalog.strpos(v_queue_constraint, '''mention''') = 0
     or pg_catalog.strpos(v_queue_constraint, '''heads_up''') = 0
     or pg_catalog.strpos(v_queue_constraint, '''assignment''') = 0
     or pg_catalog.strpos(v_queue_constraint, '''status_change''') = 0
     or pg_catalog.strpos(v_queue_constraint, '''unlock''') = 0
     or pg_catalog.strpos(v_queue_constraint, '''backup_request''') = 0 then
    raise exception 'R1 stopped: push queue type constraint differs from the latest P1 definition.';
  end if;
  select count(*)
  into v_new_type_count
  from pg_catalog.unnest(array[
    'volunteer_offer', 'leave_requested', 'leave_cancelled', 'leave_approved', 'leave_denied'
  ]) as proposed(type_name)
  where pg_catalog.strpos(v_queue_constraint, pg_catalog.quote_literal(proposed.type_name)) > 0;
  if v_new_type_count not in (0, 5) then
    raise exception 'R1 stopped: push queue constraint contains a partial R1 type set.';
  end if;

  if to_regprocedure('ceit_connect_private.insert_notifications(text,uuid,uuid,uuid[])') is null
     or to_regprocedure('public.claim_push_deliveries(integer)') is null
     or to_regprocedure('ceit_connect_private.suppress_approved_leave_notifications()') is null then
    raise exception 'R1 stopped: a required latest notification function is missing.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    where procedure.oid = 'ceit_connect_private.insert_notifications(text,uuid,uuid,uuid[])'::regprocedure
      and procedure.proowner = 'postgres'::regrole
      and procedure.prosecdef
      and procedure.provolatile = 'v'
      and procedure.proconfig = array['search_path=""']
  ) or pg_catalog.has_function_privilege(
    'service_role', 'ceit_connect_private.insert_notifications(text,uuid,uuid,uuid[])', 'EXECUTE'
  ) then
    raise exception 'R1 stopped: insert_notifications differs from the latest N1 security definition.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    where procedure.oid = 'public.claim_push_deliveries(integer)'::regprocedure
      and procedure.proowner = 'postgres'::regrole
      and procedure.prosecdef
      and procedure.provolatile = 'v'
      and procedure.proconfig = array['search_path=""']
  ) or not pg_catalog.has_function_privilege(
    'anon', 'public.claim_push_deliveries(integer)', 'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'authenticated', 'public.claim_push_deliveries(integer)', 'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'service_role', 'public.claim_push_deliveries(integer)', 'EXECUTE'
  ) then
    raise exception 'R1 stopped: claim_push_deliveries differs from the latest P1 security definition.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger as trigger_row
    where trigger_row.tgrelid = 'public.task_leave_requests'::regclass
      and trigger_row.tgname = 'task_leave_requests_z8_notification_suppression'
      and not trigger_row.tgisinternal
  ) then
    raise exception 'R1 stopped: the latest leave-approval suppression trigger is missing.';
  end if;
end
$$;

alter table public.notifications
drop constraint notifications_type_check;
alter table public.notifications
add constraint notifications_type_check check (type in (
  'mention', 'heads_up', 'assignment', 'status_change', 'unlock', 'backup_request',
  'volunteer_offer', 'leave_requested', 'leave_cancelled', 'leave_approved', 'leave_denied'
));

alter table ceit_connect_private.push_delivery_queue
drop constraint push_delivery_queue_notification_type_check;
alter table ceit_connect_private.push_delivery_queue
add constraint push_delivery_queue_notification_type_check check (notification_type in (
  'mention', 'heads_up', 'assignment', 'status_change', 'unlock', 'backup_request',
  'volunteer_offer', 'leave_requested', 'leave_cancelled', 'leave_approved', 'leave_denied'
));

create or replace function ceit_connect_private.insert_notifications(
  p_type text,
  p_task_id uuid,
  p_actor_id uuid,
  p_recipient_ids uuid[]
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
    'volunteer_offer', 'leave_requested', 'leave_cancelled', 'leave_approved', 'leave_denied'
  ) or p_task_id is null then
    raise exception 'Notification metadata is invalid.';
  end if;

  insert into public.notifications (user_id, type, task_id)
  select recipient.user_id, p_type, p_task_id
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

alter function ceit_connect_private.insert_notifications(text, uuid, uuid, uuid[])
owner to postgres;
revoke all on function ceit_connect_private.insert_notifications(text, uuid, uuid, uuid[])
from public, anon, authenticated, service_role;

create or replace function ceit_connect_private.notify_task_volunteer_offer()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_event_status text;
  v_task_status text;
  v_request_backup boolean;
  v_committee_id uuid;
  v_primary_assignees uuid[];
  v_recipient_ids uuid[];
begin
  select event_row.status,
         task_row.status,
         task_row.request_backup,
         task_row.committee_id,
         task_row.primary_assignees
  into v_event_status,
       v_task_status,
       v_request_backup,
       v_committee_id,
       v_primary_assignees
  from public.tasks as task_row
  join public.events as event_row on event_row.id = task_row.event_id
  where task_row.id = new.task_id;

  if not found
     or v_event_status is distinct from 'Active'
     or v_task_status = 'Completed'
     or v_request_backup is not true then
    return new;
  end if;

  select coalesce(
    pg_catalog.array_agg(profile.id order by profile.id),
    '{}'::uuid[]
  )
  into v_recipient_ids
  from public.users as profile
  where profile.is_active is true
    and (
      profile.role = 'Admin'
      or (profile.role = 'Co-Admin' and profile.committee_id = v_committee_id)
      or profile.id = any(v_primary_assignees)
    )
    and public.task_content_access_for_user(new.task_id, profile.id) = 'real';

  perform ceit_connect_private.insert_notifications(
    'volunteer_offer', new.task_id, new.user_id, v_recipient_ids
  );
  return new;
end;
$$;

alter function ceit_connect_private.notify_task_volunteer_offer() owner to postgres;
revoke all on function ceit_connect_private.notify_task_volunteer_offer()
from public, anon, authenticated, service_role;

drop trigger if exists task_volunteers_z8_notifications on public.task_volunteers;
create trigger task_volunteers_z8_notifications
after insert on public.task_volunteers
for each row execute function ceit_connect_private.notify_task_volunteer_offer();

create or replace function ceit_connect_private.notify_task_leave_request()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_event_status text;
  v_committee_id uuid;
  v_notification_type text;
  v_actor_id uuid;
  v_recipient_ids uuid[] := '{}'::uuid[];
begin
  select event_row.status, task_row.committee_id
  into v_event_status, v_committee_id
  from public.tasks as task_row
  join public.events as event_row on event_row.id = task_row.event_id
  where task_row.id = new.task_id;

  if not found or v_event_status is distinct from 'Active' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status is distinct from 'pending' then
      return new;
    end if;
    v_notification_type := 'leave_requested';
    v_actor_id := new.requester_id;
  elsif tg_op = 'UPDATE'
     and old.status = 'pending'
     and new.status = 'cancelled'
     and new.stale_reason is null
     and new.resolved_by = new.requester_id then
    v_notification_type := 'leave_cancelled';
    v_actor_id := new.requester_id;
  elsif tg_op = 'UPDATE'
     and old.status = 'pending'
     and new.status in ('approved', 'denied')
     and new.stale_reason is null
     and new.resolved_by is not null then
    v_notification_type := case new.status
      when 'approved' then 'leave_approved'
      else 'leave_denied'
    end;
    v_actor_id := new.resolved_by;
    v_recipient_ids := array[new.requester_id]::uuid[];
  else
    return new;
  end if;

  if v_notification_type in ('leave_requested', 'leave_cancelled') then
    select coalesce(
      pg_catalog.array_agg(profile.id order by profile.id),
      '{}'::uuid[]
    )
    into v_recipient_ids
    from public.users as profile
    where profile.is_active is true
      and (
        profile.role = 'Admin'
        or (profile.role = 'Co-Admin' and profile.committee_id = v_committee_id)
      )
      and public.task_content_access_for_user(new.task_id, profile.id) = 'real';
  end if;

  perform ceit_connect_private.insert_notifications(
    v_notification_type, new.task_id, v_actor_id, v_recipient_ids
  );
  return new;
end;
$$;

alter function ceit_connect_private.notify_task_leave_request() owner to postgres;
revoke all on function ceit_connect_private.notify_task_leave_request()
from public, anon, authenticated, service_role;

drop trigger if exists task_leave_requests_z8_request_notifications
on public.task_leave_requests;
create trigger task_leave_requests_z8_request_notifications
after insert or update of status on public.task_leave_requests
for each row execute function ceit_connect_private.notify_task_leave_request();

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
         end,
         '/notifications'::text,
         leased.notification_type,
         leased.attempt_count,
         leased.lease_expires_at
  from leased
  join public.push_subscriptions as subscription
    on subscription.id = leased.subscription_id;

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

comment on function ceit_connect_private.notify_task_volunteer_offer() is
  'R1 set-wise volunteer-offer notifications for current active approvers with real task access.';
comment on function ceit_connect_private.notify_task_leave_request() is
  'R1 leave request, cancellation, approval, and denial notifications; system-driven closures remain silent.';
