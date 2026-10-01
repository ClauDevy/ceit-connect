alter table users add column password_set boolean not null default false;

update users u set password_set = true
from auth.users a
where a.id = u.id and coalesce(a.encrypted_password, '') <> '';