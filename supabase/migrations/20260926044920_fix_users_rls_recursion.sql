-- Helper functions that look up the current user's own role/committee
-- WITHOUT triggering RLS on themselves (breaks the recursion loop).
create or replace function my_role() returns text
language sql security definer stable
as $$
  select role from users where id = auth.uid()
$$;

create or replace function my_committee_id() returns uuid
language sql security definer stable
as $$
  select committee_id from users where id = auth.uid()
$$;

-- Replace the old self-referencing policies with ones that use the
-- helper functions instead of querying `users` directly.
drop policy "co_admin_view_own_committee_members" on users;
create policy "co_admin_view_own_committee_members"
on users for select
to authenticated
using (my_role() = 'Co-Admin' and my_committee_id() = committee_id);

drop policy "co_admin_update_own_committee_members" on users;
create policy "co_admin_update_own_committee_members"
on users for update
to authenticated
using (my_role() = 'Co-Admin' and my_committee_id() = committee_id);

drop policy "admin_full_access_users" on users;
create policy "admin_full_access_users"
on users for all
to authenticated
using (my_role() = 'Admin');