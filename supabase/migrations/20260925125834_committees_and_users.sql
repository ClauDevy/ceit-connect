-- ========== COMMITTEES ==========
-- Lookup table, not an enum, per §2: renaming/retiring a committee
-- becomes a data update instead of a schema migration.
create table committees (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  created_at timestamptz not null default now()
);

insert into committees (name) values
  ('President'), ('CIA'), ('COEXA'), ('COMRECS'), ('COFBUM'),
  ('CARA'), ('COPI'), ('COPR'), ('COBAP'), ('COSEA'), ('COSCA'), ('COSRAW');

alter table committees enable row level security;

-- Every logged-in user can read the committee list (needed for dropdowns,
-- filters, etc.) — nothing sensitive lives in this table.
create policy "authenticated_read_committees"
on committees for select
to authenticated
using (true);


-- ========== USERS ==========
-- id matches auth.users.id 1:1 — this table holds the app-specific
-- profile data (role, committee) that Supabase Auth doesn't know about.
create table users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null,
  role text not null check (role in ('Admin', 'Co-Admin', 'Member')),
  committee_id uuid references committees(id),
  discord_id text,
  avatar_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table users enable row level security;

-- Everyone can see their own row (needed for the app to know "who am I").
create policy "users_select_own_row"
on users for select
to authenticated
using (id = auth.uid());

-- Co-Admins can view members of their own committee — straight from §2.1.
create policy "co_admin_view_own_committee_members"
on users for select
to authenticated
using (
  exists (
    select 1 from users me
    where me.id = auth.uid()
      and me.role = 'Co-Admin'
      and me.committee_id = users.committee_id
  )
);

-- Co-Admins can update members of their own committee — §2.1.
create policy "co_admin_update_own_committee_members"
on users for update
to authenticated
using (
  exists (
    select 1 from users me
    where me.id = auth.uid()
      and me.role = 'Co-Admin'
      and me.committee_id = users.committee_id
  )
);

-- Admins bypass the committee filter entirely — full access, all rows.
create policy "admin_full_access_users"
on users for all
to authenticated
using (
  exists (select 1 from users me where me.id = auth.uid() and me.role = 'Admin')
);