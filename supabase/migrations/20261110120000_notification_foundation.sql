-- Phase 5 N1: persistent in-app notification foundation.
-- Notification rows contain routing metadata only. Task text is resolved and
-- masked at read time through the latest authoritative content-access helper.

do $$
declare
  v_publication_all_tables boolean;
  v_publication_membership_count integer;
  v_has_select boolean;
  v_has_insert boolean;
  v_has_update boolean;
  v_has_delete boolean;
begin
  if current_user <> 'postgres' then
    raise exception 'N1 must be applied by postgres; current_user is %.', current_user;
  end if;

  select
    pg_catalog.has_table_privilege('authenticated', 'public.notifications', 'SELECT'),
    pg_catalog.has_table_privilege('authenticated', 'public.notifications', 'INSERT'),
    pg_catalog.has_table_privilege('authenticated', 'public.notifications', 'UPDATE'),
    pg_catalog.has_table_privilege('authenticated', 'public.notifications', 'DELETE')
  into v_has_select, v_has_insert, v_has_update, v_has_delete;

  if v_has_select is not true
     or not (
       (v_has_insert and v_has_update and v_has_delete)
       or (not v_has_insert and not v_has_update and not v_has_delete)
     ) then
    raise exception 'N1 stopped: notifications privileges are outside the approved pre-N1 or rerun state.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policies as policy_row
    where policy_row.schemaname = 'public'
      and policy_row.tablename = 'notifications'
      and policy_row.policyname = 'notifications_select_own'
      and policy_row.cmd = 'SELECT'
      and policy_row.roles = array['authenticated']::name[]
      and (
        (
          policy_row.qual = '(user_id = auth.uid())'
          and policy_row.with_check is null
        )
        or (
          policy_row.qual like '%user_id = auth.uid()%'
          and policy_row.qual like '%my_role() IS NOT NULL%'
          and policy_row.with_check is null
        )
      )
  ) or not exists (
    select 1
    from pg_catalog.pg_policies as policy_row
    where policy_row.schemaname = 'public'
      and policy_row.tablename = 'notifications'
      and policy_row.policyname = 'notifications_update_own'
      and policy_row.cmd = 'UPDATE'
      and policy_row.roles = array['authenticated']::name[]
      and (
        (
          policy_row.qual = '(user_id = auth.uid())'
          and policy_row.with_check is null
        )
        or (
          policy_row.qual = 'false'
          and policy_row.with_check = 'false'
        )
      )
  ) then
    raise exception 'N1 stopped: notification policies differ from the latest pre-N1 or N1 definitions.';
  end if;

  select publication.puballtables
  into v_publication_all_tables
  from pg_catalog.pg_publication as publication
  where publication.pubname = 'supabase_realtime';
  if not found then
    raise exception 'N1 stopped: the supabase_realtime publication does not exist.';
  end if;

  select count(*)::integer
  into v_publication_membership_count
  from pg_catalog.pg_publication_tables as publication_table
  where publication_table.pubname = 'supabase_realtime'
    and publication_table.schemaname = 'public'
    and publication_table.tablename = 'notifications';

  if v_publication_all_tables is false
     and v_publication_membership_count not in (0, 1) then
    raise exception 'N1 stopped: notifications has an unexpected Realtime publication membership count.';
  end if;
end
$$;

create index if not exists notifications_user_page_idx
on public.notifications (user_id, created_at desc, id desc);

create index if not exists notifications_user_unread_idx
on public.notifications (user_id)
where read_at is null;

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own"
on public.notifications for select
to authenticated
using (
  user_id = auth.uid()
  and public.my_role() is not null
);

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own"
on public.notifications for update
to authenticated
using (false)
with check (false);

revoke insert, update, delete on table public.notifications from authenticated;
grant select on table public.notifications to authenticated;

do $$
declare
  v_publication_all_tables boolean;
begin
  select publication.puballtables
  into strict v_publication_all_tables
  from pg_catalog.pg_publication as publication
  where publication.pubname = 'supabase_realtime';

  if v_publication_all_tables is false and not exists (
    select 1
    from pg_catalog.pg_publication_tables as publication_table
    where publication_table.pubname = 'supabase_realtime'
      and publication_table.schemaname = 'public'
      and publication_table.tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$$;

create table if not exists ceit_connect_private.notification_suppression_context (
  transaction_id xid8 not null,
  task_id uuid not null,
  primary key (transaction_id, task_id)
);

alter table ceit_connect_private.notification_suppression_context owner to postgres;
alter table ceit_connect_private.notification_suppression_context enable row level security;
revoke all on table ceit_connect_private.notification_suppression_context
from public, anon, authenticated, service_role;

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
    'mention', 'assignment', 'status_change',
    'unlock', 'backup_request', 'heads_up'
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

create or replace function ceit_connect_private.suppress_approved_leave_notifications()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if old.status = 'pending' and new.status = 'approved' then
    insert into ceit_connect_private.notification_suppression_context (
      transaction_id,
      task_id
    ) values (
      pg_catalog.pg_current_xact_id(),
      new.task_id
    )
    on conflict (transaction_id, task_id) do nothing;
  end if;
  return new;
end;
$$;

alter function ceit_connect_private.suppress_approved_leave_notifications()
owner to postgres;
revoke all on function ceit_connect_private.suppress_approved_leave_notifications()
from public, anon, authenticated, service_role;

drop trigger if exists task_leave_requests_z8_notification_suppression
on public.task_leave_requests;
create trigger task_leave_requests_z8_notification_suppression
after update of status on public.task_leave_requests
for each row
execute function ceit_connect_private.suppress_approved_leave_notifications();

create or replace function ceit_connect_private.notify_task_change()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_event_status text;
  v_assignment_ids uuid[] := '{}'::uuid[];
  v_status_ids uuid[] := '{}'::uuid[];
  v_backup_ids uuid[] := '{}'::uuid[];
  v_suppressed boolean;
begin
  select exists (
    select 1
    from ceit_connect_private.notification_suppression_context as context_row
    where context_row.transaction_id = pg_catalog.pg_current_xact_id()
      and context_row.task_id = new.id
  ) into v_suppressed;

  if v_suppressed then
    delete from ceit_connect_private.notification_suppression_context as context_row
    where context_row.transaction_id = pg_catalog.pg_current_xact_id()
      and context_row.task_id = new.id;
    return new;
  end if;

  select event_row.status
  into v_event_status
  from public.events as event_row
  where event_row.id = new.event_id;

  if v_event_status is distinct from 'Active' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    select coalesce(pg_catalog.array_agg(candidate.user_id order by candidate.user_id), '{}'::uuid[])
    into v_assignment_ids
    from (
      select distinct proposed.user_id
      from pg_catalog.unnest(new.primary_assignees || new.assist_assignees)
        as proposed(user_id)
    ) as candidate;
  else
    select coalesce(pg_catalog.array_agg(candidate.user_id order by candidate.user_id), '{}'::uuid[])
    into v_assignment_ids
    from (
      select distinct proposed.user_id
      from pg_catalog.unnest(new.primary_assignees || new.assist_assignees)
        as proposed(user_id)
      except
      select distinct previous.user_id
      from pg_catalog.unnest(old.primary_assignees || old.assist_assignees)
        as previous(user_id)
    ) as candidate;
  end if;

  if pg_catalog.cardinality(v_assignment_ids) > 0 then
    perform ceit_connect_private.insert_notifications(
      'assignment', new.id, v_actor_id, v_assignment_ids
    );
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    select coalesce(pg_catalog.array_agg(candidate.user_id order by candidate.user_id), '{}'::uuid[])
    into v_status_ids
    from (
      select distinct proposed.user_id
      from pg_catalog.unnest(new.primary_assignees || new.assist_assignees)
        as proposed(user_id)
    ) as candidate;

    perform ceit_connect_private.insert_notifications(
      'status_change', new.id, v_actor_id, v_status_ids
    );

    if old.status is distinct from 'Completed'
       and new.status = 'Completed' then
      insert into public.notifications (user_id, type, task_id)
      select distinct recipient.user_id, 'unlock', dependent.id
      from public.tasks as dependent
      join public.events as dependent_event
        on dependent_event.id = dependent.event_id
       and dependent_event.status = 'Active'
      cross join lateral pg_catalog.unnest(
        dependent.primary_assignees || dependent.assist_assignees
      ) as recipient(user_id)
      join public.users as profile
        on profile.id = recipient.user_id
       and profile.is_active is true
      where dependent.depends_on_task_id = new.id
        and dependent.status <> 'Completed'
        and recipient.user_id is distinct from v_actor_id;
    end if;
  end if;

  if tg_op = 'UPDATE'
     and new.request_backup is true
     and old.request_backup is distinct from true then
    select coalesce(pg_catalog.array_agg(profile.id order by profile.id), '{}'::uuid[])
    into v_backup_ids
    from public.users as profile
    where profile.is_active is true
      and (
        profile.role = 'Admin'
        or (
          profile.role = 'Co-Admin'
          and profile.committee_id = new.committee_id
        )
      );

    perform ceit_connect_private.insert_notifications(
      'backup_request', new.id, v_actor_id, v_backup_ids
    );
  end if;

  return new;
end;
$$;

alter function ceit_connect_private.notify_task_change() owner to postgres;
revoke all on function ceit_connect_private.notify_task_change()
from public, anon, authenticated, service_role;

drop trigger if exists tasks_z8_notifications on public.tasks;
create trigger tasks_z8_notifications
after insert or update of status, primary_assignees, assist_assignees, request_backup
on public.tasks
for each row
execute function ceit_connect_private.notify_task_change();

create or replace function ceit_connect_private.notify_event_launch()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
begin
  if old.status = 'Draft' and new.status = 'Active' then
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
  end if;
  return new;
end;
$$;

alter function ceit_connect_private.notify_event_launch() owner to postgres;
revoke all on function ceit_connect_private.notify_event_launch()
from public, anon, authenticated, service_role;

drop trigger if exists events_z8_notification_launch on public.events;
create trigger events_z8_notification_launch
after update of status on public.events
for each row
execute function ceit_connect_private.notify_event_launch();

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
      'mention', new.task_id, new.created_by, v_mention_ids
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

drop trigger if exists task_comments_z8_notifications on public.task_comments;
create trigger task_comments_z8_notifications
after insert or update of is_heads_up, mentioned_user_ids on public.task_comments
for each row
execute function ceit_connect_private.notify_task_comment();

create or replace function ceit_connect_private.notification_unread_count_for_user(
  p_user_id uuid
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)
  from public.notifications as notification_row
  where notification_row.user_id = p_user_id
    and notification_row.read_at is null
$$;

alter function ceit_connect_private.notification_unread_count_for_user(uuid)
owner to postgres;
revoke all on function ceit_connect_private.notification_unread_count_for_user(uuid)
from public, anon, authenticated, service_role;

create or replace function public.get_notification_unread_count()
returns bigint
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

  return ceit_connect_private.notification_unread_count_for_user(v_caller_id);
end;
$$;

alter function public.get_notification_unread_count() owner to postgres;
revoke all on function public.get_notification_unread_count()
from public, anon, authenticated, service_role;
grant execute on function public.get_notification_unread_count() to authenticated;

create or replace function ceit_connect_private.list_notifications_for_user(
  p_user_id uuid,
  p_limit integer,
  p_before_created_at timestamptz,
  p_before_id uuid
)
returns table (
  out_id uuid,
  out_type text,
  out_task_id uuid,
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

create or replace function public.list_notifications(
  p_limit integer default 21,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  out_id uuid,
  out_type text,
  out_task_id uuid,
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

create or replace function public.mark_notification_read(p_notification_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
  v_affected integer;
begin
  if p_notification_id is null then
    raise exception using errcode = '22023', message = 'A notification ID is required.';
  end if;
  if not exists (
    select 1
    from public.users as profile
    where profile.id = v_caller_id
      and profile.is_active is true
  ) then
    raise exception using errcode = '42501', message = 'An active profile is required.';
  end if;

  update public.notifications as notification_row
  set read_at = coalesce(notification_row.read_at, pg_catalog.clock_timestamp())
  where notification_row.id = p_notification_id
    and notification_row.user_id = v_caller_id;
  get diagnostics v_affected = row_count;
  return v_affected = 1;
end;
$$;

alter function public.mark_notification_read(uuid) owner to postgres;
revoke all on function public.mark_notification_read(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.mark_notification_read(uuid) to authenticated;

create or replace function public.mark_all_notifications_read()
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
  v_affected bigint;
begin
  if not exists (
    select 1
    from public.users as profile
    where profile.id = v_caller_id
      and profile.is_active is true
  ) then
    raise exception using errcode = '42501', message = 'An active profile is required.';
  end if;

  update public.notifications as notification_row
  set read_at = pg_catalog.clock_timestamp()
  where notification_row.user_id = v_caller_id
    and notification_row.read_at is null;
  get diagnostics v_affected = row_count;
  return v_affected;
end;
$$;

alter function public.mark_all_notifications_read() owner to postgres;
revoke all on function public.mark_all_notifications_read()
from public, anon, authenticated, service_role;
grant execute on function public.mark_all_notifications_read() to authenticated;

do $$
begin
  if not (
    pg_catalog.has_table_privilege('authenticated', 'public.notifications', 'SELECT')
    and not pg_catalog.has_table_privilege('authenticated', 'public.notifications', 'INSERT')
    and not pg_catalog.has_table_privilege('authenticated', 'public.notifications', 'UPDATE')
    and not pg_catalog.has_table_privilege('authenticated', 'public.notifications', 'DELETE')
  ) then
    raise exception 'N1 did not produce the exact notification privilege boundary.';
  end if;
end
$$;
