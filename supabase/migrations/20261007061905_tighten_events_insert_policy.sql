drop policy "events_insert" on events;

create policy "events_insert"
on events for insert
to authenticated
with check (
  my_role() in ('Admin', 'Co-Admin')
  and created_by = auth.uid()
);