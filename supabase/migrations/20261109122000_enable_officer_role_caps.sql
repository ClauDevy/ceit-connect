-- Phase 4B Batch 14: enable the already-shipped officer seat caps. Existing
-- over-limit accounts are not rewritten; only later additive operations use
-- the enabled cap checks.

do $$
declare
  v_affected integer;
begin
  if current_user <> 'postgres' then
    raise exception 'Batch 14 officer-cap enablement must be applied by postgres; current_user is %.',
      current_user;
  end if;

  update public.app_settings
  set enforce_officer_role_caps = true
  where key = 'global';

  get diagnostics v_affected = row_count;
  if v_affected <> 1 then
    raise exception 'Batch 14 officer-cap enablement expected exactly one global settings row; updated %.',
      v_affected;
  end if;

  if not exists (
    select 1
    from public.app_settings as setting
    where setting.key = 'global'
      and setting.enforce_officer_role_caps
  ) then
    raise exception 'Batch 14 officer-cap enablement did not persist the enabled value.';
  end if;
end
$$;

comment on column public.app_settings.enforce_officer_role_caps is
  'Enabled by Batch 14. Limits later additive officer invitations, appointments, and activations without rewriting existing accounts.';
