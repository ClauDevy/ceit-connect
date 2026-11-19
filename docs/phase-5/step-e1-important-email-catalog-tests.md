# E1 important email catalog paste

Run after `npx supabase db push`. This paste creates no temp table, is
self-contained, and intentionally rolls back. Expected final exception:
`TEST RESULTS 25/25 PASS — transaction intentionally rolled back`.

```sql
begin;
create table public.e1_catalog_results (
  label text primary key,
  passed boolean not null
);
revoke all on public.e1_catalog_results from public, anon, authenticated, service_role;

insert into public.e1_catalog_results values
('01 preference table private',
  to_regclass('ceit_connect_private.user_email_preferences') is not null),
('02 queue table private',
  to_regclass('ceit_connect_private.email_delivery_queue') is not null),
('03 attempt table private',
  to_regclass('ceit_connect_private.email_send_attempts') is not null),
('04 run table private',
  to_regclass('ceit_connect_private.email_delivery_runs') is not null),
('05 credential table private',
  to_regclass('ceit_connect_private.email_sender_credentials') is not null),
('06 getter exists',
  to_regprocedure('public.get_important_email_updates_enabled()') is not null),
('07 setter exists',
  to_regprocedure('public.set_important_email_updates_enabled(boolean)') is not null),
('08 ready probe exists',
  to_regprocedure('public.email_sender_ready()') is not null),
('09 claim exact signature',
  to_regprocedure('public.claim_email_deliveries(integer)') is not null),
('10 acknowledge exact signature',
  to_regprocedure('public.acknowledge_email_delivery(uuid,uuid,text,integer)') is not null),
('11 finish exact signature',
  to_regprocedure('public.finish_email_delivery_run(uuid,uuid)') is not null),
('12 no service claim execute',
  not has_function_privilege('service_role','public.claim_email_deliveries(integer)','EXECUTE')),
('13 anon claim execute',
  has_function_privilege('anon','public.claim_email_deliveries(integer)','EXECUTE')),
('14 authenticated setter execute',
  has_function_privilege('authenticated','public.set_important_email_updates_enabled(boolean)','EXECUTE')),
('15 no authenticated queue access',
  not has_table_privilege('authenticated','ceit_connect_private.email_delivery_queue','SELECT')),
('16 seed trigger exists', exists(
  select 1 from pg_catalog.pg_trigger
  where tgrelid='public.users'::regclass and tgname='users_z9_seed_email_preference'
    and not tgisinternal)),
('17 enqueue trigger exists', exists(
  select 1 from pg_catalog.pg_trigger
  where tgrelid='public.notifications'::regclass and tgname='notifications_z8_enqueue_important_email'
    and not tgisinternal)),
('18 race boundaries are catalog pinned', exists(
  select 1 from pg_catalog.pg_proc
  where oid='public.claim_email_deliveries(integer)'::regprocedure
    and pg_catalog.strpos(pg_get_functiondef(oid),'for update of queue skip locked')>0
    and pg_catalog.strpos(pg_get_functiondef(oid),'authenticate_email_sender()')>0)),
('19 acknowledgement rejects null outcome', exists(
  select 1 from pg_catalog.pg_proc
  where oid='public.acknowledge_email_delivery(uuid,uuid,text,integer)'::regprocedure
    and pg_catalog.strpos(pg_get_functiondef(oid),'p_outcome is null')>0)),
('20 kick checks allowance before Vault', exists(
  select 1 from pg_catalog.pg_proc
  where oid='ceit_connect_private.request_email_kick_if_due()'::regprocedure
    and pg_catalog.strpos(pg_get_functiondef(oid),'if v_used >= v_allowance')>0
    and pg_catalog.strpos(pg_get_functiondef(oid),'if v_used >= v_allowance')
      < pg_catalog.strpos(pg_get_functiondef(oid),'vault.decrypted_secrets'))),
('21 allowance run rows are hourly bounded', exists(
  select 1 from pg_catalog.pg_proc
  where oid='public.claim_email_deliveries(integer)'::regprocedure
    and pg_catalog.strpos(pg_get_functiondef(oid),
      'run_row.allowance_reached_count = 1')>0
    and pg_catalog.strpos(pg_get_functiondef(oid),
      'date_trunc(''hour'', v_now)')>0)),
('22 send preparation exists and is anon-capability callable',
  to_regprocedure('public.prepare_email_delivery(uuid,uuid)') is not null
  and has_function_privilege('anon','public.prepare_email_delivery(uuid,uuid)','EXECUTE')
  and not has_function_privilege('service_role','public.prepare_email_delivery(uuid,uuid)','EXECUTE')),
('23 quota ledger survives queue deletion', not exists(
  select 1 from pg_catalog.pg_constraint
  where conrelid='ceit_connect_private.email_send_attempts'::regclass
    and contype='f')),
('24 rolling allowance is pinned in claim and kick', exists(
  select 1 from pg_catalog.pg_proc
  where oid='public.claim_email_deliveries(integer)'::regprocedure
    and pg_catalog.strpos(pg_get_functiondef(oid),'''24 hours''')>0)
  and exists(
    select 1 from pg_catalog.pg_proc
    where oid='ceit_connect_private.request_email_kick_if_due()'::regprocedure
      and pg_catalog.strpos(pg_get_functiondef(oid),'''24 hours''')>0)),
('25 preparation uses current task access', exists(
  select 1 from pg_catalog.pg_proc
  where oid='public.prepare_email_delivery(uuid,uuid)'::regprocedure
    and pg_catalog.strpos(pg_get_functiondef(oid),'task_content_access_for_user')>0
    and pg_catalog.strpos(pg_get_functiondef(oid),'/workspace')>0)
  and exists(
    select 1 from pg_catalog.pg_trigger
    where tgrelid='public.tasks'::regclass
      and tgname='tasks_y9_guard_email_send_content'
      and not tgisinternal));

do $$
declare
  v_total integer;
  v_failed integer;
  v_labels text;
begin
  select pg_catalog.count(*)::integer,
         pg_catalog.count(*) filter (where passed is false)::integer,
         string_agg(label, ', ' order by label) filter (where passed is false)
  into v_total, v_failed, v_labels
  from public.e1_catalog_results;
  if v_total <> 25 or v_failed <> 0 then
    raise exception 'TEST RESULTS %/25 FAIL — % failed: %; transaction intentionally rolled back',
      v_total-v_failed, v_failed, coalesce(v_labels, 'count mismatch');
  end if;
  raise exception 'TEST RESULTS 25/25 PASS — transaction intentionally rolled back';
end;
$$;
rollback;
```
