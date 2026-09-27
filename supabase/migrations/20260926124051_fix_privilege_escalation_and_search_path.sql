-- Fix 1: pin search_path on both SECURITY DEFINER helper functions,
-- closing a schema-injection risk.
create or replace function my_role() returns text
language sql security definer stable
set search_path = public
as $$
  select role from users where id = auth.uid()
$$;

create or replace function my_committee_id() returns uuid
language sql security definer stable
set search_path = public
as $$
  select committee_id from users where id = auth.uid()
$$;

-- Fix 2: stop a Co-Admin from promoting themselves (or a committee
-- member) to Admin via this policy.
drop policy "co_admin_update_own_committee_members" on users;
create policy "co_admin_update_own_committee_members"
on users for update
to authenticated
using (my_role() = 'Co-Admin' and my_committee_id() = committee_id)
with check (my_role() = 'Co-Admin' and my_committee_id() = committee_id and role <> 'Admin');