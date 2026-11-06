-- Batch A: event end_date is the complete Asia/Manila calendar day.
-- Existing out-of-range rows are grandfathered until the individual schedule
-- field changes. Event extensions never scan or reject retained tasks.
-- Repository-wide CCD0x/CCPxx review reserves CCD01 for its existing
-- prerequisite-deletion and Draft-limit meanings. CCD05 was unused before
-- this unapplied migration and is assigned only to the due_date bound below.

create function ceit_connect_private.schedule_after_event_end(
  p_value timestamptz,
  p_end_date date
)
returns boolean language sql immutable strict security invoker set search_path=''
as $$ select pg_catalog.timezone('Asia/Manila',p_value)::date > p_end_date $$;
alter function ceit_connect_private.schedule_after_event_end(timestamptz,date) owner to postgres;
revoke all on function ceit_connect_private.schedule_after_event_end(timestamptz,date)
from public,anon,authenticated,service_role;

create function ceit_connect_private.guard_task_event_end()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
  v_end_date date;
  v_override_is_set boolean :=
    current_user='postgres'
    and coalesce(current_setting('ceit_connect.event_end_override_writer',true),'')='edit_event_with_tasks'
    and coalesce(current_setting('ceit_connect.event_end_override_event_id',true),'')=new.event_id::text
    and coalesce(current_setting('ceit_connect.event_end_override_is_set',true),'')='true';
begin
  if v_override_is_set then
    v_end_date:=nullif(current_setting('ceit_connect.event_end_override_value',true),'')::date;
  else
    select event_row.end_date into v_end_date
    from public.events event_row where event_row.id=new.event_id;
  end if;
  if v_end_date is null then return new;end if;

  -- INSERT validates every supplied field. UPDATE validates only fields that
  -- are actually distinct, so unrelated edits to grandfathered rows succeed.
  if (tg_op='INSERT' or new.due_date is distinct from old.due_date)
     and new.due_date is not null
     and ceit_connect_private.schedule_after_event_end(new.due_date,v_end_date) then
    raise exception using errcode='CCD05',message='due_date is after the event end date.';
  end if;
  if (tg_op='INSERT' or new.call_time is distinct from old.call_time)
     and new.call_time is not null
     and ceit_connect_private.schedule_after_event_end(new.call_time,v_end_date) then
    raise exception using errcode='CCD02',message='call_time is after the event end date.';
  end if;
  if (tg_op='INSERT' or new.end_time is distinct from old.end_time)
     and new.end_time is not null
     and ceit_connect_private.schedule_after_event_end(new.end_time,v_end_date) then
    raise exception using errcode='CCD03',message='end_time is after the event end date.';
  end if;
  return new;
end;
$$;
alter function ceit_connect_private.guard_task_event_end() owner to postgres;
revoke all on function ceit_connect_private.guard_task_event_end() from public,anon,authenticated,service_role;

-- Alphabetically after tasks_guard_archived_event_writes and
-- tasks_h0_guard_completed_phase_writes, preserving both freezes' precedence.
create trigger tasks_i0_guard_event_end
before insert or update of due_date,call_time,end_time on public.tasks
for each row execute function ceit_connect_private.guard_task_event_end();

create function ceit_connect_private.guard_event_end_shortening()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if new.end_date is not distinct from old.end_date or new.end_date is null then return new;end if;
  -- Extending from a non-null date is always allowed. Only null -> value or a
  -- strictly earlier date can invalidate retained schedules.
  if old.end_date is not null and new.end_date >= old.end_date then return new;end if;
  if exists(
    select 1 from public.tasks task_row where task_row.event_id=new.id and (
      (task_row.due_date is not null and ceit_connect_private.schedule_after_event_end(task_row.due_date,new.end_date))
      or (task_row.call_time is not null and ceit_connect_private.schedule_after_event_end(task_row.call_time,new.end_date))
      or (task_row.end_time is not null and ceit_connect_private.schedule_after_event_end(task_row.end_time,new.end_date))
    )
  ) then raise exception using errcode='CCD04',message='The new event end date is before one or more retained task schedules.';end if;
  return new;
end;
$$;
alter function ceit_connect_private.guard_event_end_shortening() owner to postgres;
revoke all on function ceit_connect_private.guard_event_end_shortening() from public,anon,authenticated,service_role;

-- guard_event_updates runs first, so Archived events retain their existing
-- freeze message. The z-prefix makes the deadline guard the final event guard.
create trigger events_z0_guard_end_shortening
before update of end_date on public.events
for each row execute function ceit_connect_private.guard_event_end_shortening();
