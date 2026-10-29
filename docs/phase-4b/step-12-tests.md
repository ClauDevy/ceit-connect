# Step 12 tests

## TEST 1: catalog and grants

Expected result-line count: **10**.

Paste the whole script into the Dev SQL editor. The final `TEST RESULTS` exception is intentional and aborts the transaction, so the test rolls back.

```sql
begin;

do $test$
declare
  v_catalog jsonb;
  v_results text[] := array[]::text[];
begin
  with function_rows as (
    select function_row.*
    from pg_catalog.pg_proc as function_row
    join pg_catalog.pg_namespace as function_schema
      on function_schema.oid = function_row.pronamespace
    where function_schema.nspname = 'public'
      and function_row.proname = 'list_activity_log'
  ),
  target_function as (
    select function_row.*
    from function_rows as function_row
    where function_row.oid = pg_catalog.to_regprocedure(
      'public.list_activity_log(uuid,text,text,uuid,date,date,text,timestamp with time zone,uuid,integer)'
    )
  )
  select pg_catalog.jsonb_build_object(
    'function_count', (
      select pg_catalog.count(*)
      from function_rows
    ),
    'target_count', (
      select pg_catalog.count(*)
      from target_function
    ),
    'owner', (
      select owner_role.rolname
      from target_function as function_row
      join pg_catalog.pg_roles as owner_role
        on owner_role.oid = function_row.proowner
    ),
    'volatility', (
      select function_row.provolatile
      from target_function as function_row
    ),
    'security_definer', (
      select function_row.prosecdef
      from target_function as function_row
    ),
    'configuration', (
      select pg_catalog.to_jsonb(function_row.proconfig)
      from target_function as function_row
    ),
    'execute_grantees', (
      select coalesce(
        pg_catalog.jsonb_agg(grant_row.grantee_name order by grant_row.grantee_name),
        '[]'::jsonb
      )
      from (
        select distinct
          case
            when function_acl.grantee = 0 then 'PUBLIC'
            else grantee_role.rolname
          end as grantee_name
        from target_function as function_row
        cross join lateral pg_catalog.aclexplode(
          coalesce(
            function_row.proacl,
            pg_catalog.acldefault('f', function_row.proowner)
          )
        ) as function_acl
        left join pg_catalog.pg_roles as grantee_role
          on grantee_role.oid = function_acl.grantee
        where function_acl.privilege_type = 'EXECUTE'
      ) as grant_row
    ),
    'select_policy_count', (
      select pg_catalog.count(*)
      from pg_catalog.pg_policy as policy_row
      join pg_catalog.pg_class as table_row
        on table_row.oid = policy_row.polrelid
      join pg_catalog.pg_namespace as table_schema
        on table_schema.oid = table_row.relnamespace
      where table_schema.nspname = 'public'
        and table_row.relname = 'activity_log'
        and policy_row.polname = 'activity_log_select'
    ),
    'client_table_privilege_count', (
      select pg_catalog.count(*)
      from pg_catalog.pg_class as table_row
      join pg_catalog.pg_namespace as table_schema
        on table_schema.oid = table_row.relnamespace
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          table_row.relacl,
          pg_catalog.acldefault('r', table_row.relowner)
        )
      ) as table_acl
      left join pg_catalog.pg_roles as grantee_role
        on grantee_role.oid = table_acl.grantee
      where table_schema.nspname = 'public'
        and table_row.relname = 'activity_log'
        and (
          table_acl.grantee = 0
          or grantee_role.rolname in ('anon', 'authenticated')
        )
    ),
    'matching_index_count', (
      select pg_catalog.count(*)
      from pg_catalog.pg_index as index_row
      join pg_catalog.pg_class as index_relation
        on index_relation.oid = index_row.indexrelid
      join pg_catalog.pg_class as table_row
        on table_row.oid = index_row.indrelid
      join pg_catalog.pg_namespace as table_schema
        on table_schema.oid = table_row.relnamespace
      join pg_catalog.pg_am as access_method
        on access_method.oid = index_relation.relam
      where table_schema.nspname = 'public'
        and table_row.relname = 'activity_log'
        and index_relation.relname = 'activity_log_created_at_id_idx'
        and access_method.amname = 'btree'
        and index_row.indisvalid
        and index_row.indisready
        and index_row.indpred is null
        and index_row.indexprs is null
        and index_row.indnkeyatts = 2
        and (
          select pg_catalog.array_agg(
            indexed_column.attname
            order by index_key.position
          )
          from pg_catalog.unnest(index_row.indkey::smallint[])
            with ordinality as index_key(attribute_number, position)
          join pg_catalog.pg_attribute as indexed_column
            on indexed_column.attrelid = table_row.oid
           and indexed_column.attnum = index_key.attribute_number
          where index_key.position <= index_row.indnkeyatts
        ) = array['created_at', 'id']::name[]
    ),
    'result_columns', (
      select coalesce(
        pg_catalog.jsonb_agg(
          function_row.proargnames[argument_position]
          order by argument_position
        ) filter (
          where function_row.proargmodes[argument_position] in ('o', 'b', 't')
        ),
        '[]'::jsonb
      )
      from target_function as function_row
      cross join lateral pg_catalog.generate_subscripts(
        function_row.proargnames,
        1
      ) as argument_positions(argument_position)
    )
  )
  into v_catalog;

  v_results := pg_catalog.array_append(
    v_results,
    case
      when (v_catalog ->> 'function_count')::integer = 1
       and (v_catalog ->> 'target_count')::integer = 1
      then 'PASS: list_activity_log exists once with the expected signature and no overloads'
      else pg_catalog.format(
        'FAIL: list_activity_log count/signature mismatch (name count=%s, target count=%s)',
        v_catalog ->> 'function_count',
        v_catalog ->> 'target_count'
      )
    end
  );

  v_results := pg_catalog.array_append(
    v_results,
    case
      when v_catalog ->> 'owner' = 'postgres'
      then 'PASS: function owner is postgres'
      else pg_catalog.format('FAIL: function owner is %s', v_catalog ->> 'owner')
    end
  );

  v_results := pg_catalog.array_append(
    v_results,
    case
      when v_catalog ->> 'volatility' = 's'
      then 'PASS: function volatility is STABLE'
      else pg_catalog.format('FAIL: function volatility code is %s', v_catalog ->> 'volatility')
    end
  );

  v_results := pg_catalog.array_append(
    v_results,
    case
      when (v_catalog ->> 'security_definer')::boolean is true
      then 'PASS: function is SECURITY DEFINER'
      else 'FAIL: function is not SECURITY DEFINER'
    end
  );

  v_results := pg_catalog.array_append(
    v_results,
    case
      when v_catalog -> 'configuration' = '["search_path=\"\""]'::jsonb
      then 'PASS: function search_path is empty'
      else pg_catalog.format(
        'FAIL: function configuration is %s',
        v_catalog -> 'configuration'
      )
    end
  );

  v_results := pg_catalog.array_append(
    v_results,
    case
      when v_catalog -> 'execute_grantees' ? 'authenticated'
       and not (v_catalog -> 'execute_grantees' ? 'PUBLIC')
       and not (v_catalog -> 'execute_grantees' ? 'anon')
      then pg_catalog.format(
        'PASS: authenticated has EXECUTE while PUBLIC and anon do not; INFO: service_role EXECUTE=%s',
        case
          when v_catalog -> 'execute_grantees' ? 'service_role' then 'yes'
          else 'no'
        end
      )
      else pg_catalog.format(
        'FAIL: authenticated/PUBLIC/anon EXECUTE grants are incorrect (grantees=%s); INFO: service_role EXECUTE=%s',
        v_catalog -> 'execute_grantees',
        case
          when v_catalog -> 'execute_grantees' ? 'service_role' then 'yes'
          else 'no'
        end
      )
    end
  );

  v_results := pg_catalog.array_append(
    v_results,
    case
      when (v_catalog ->> 'select_policy_count')::integer = 0
      then 'PASS: activity_log_select policy is absent'
      else pg_catalog.format(
        'FAIL: activity_log_select policy count is %s',
        v_catalog ->> 'select_policy_count'
      )
    end
  );

  v_results := pg_catalog.array_append(
    v_results,
    case
      when (v_catalog ->> 'client_table_privilege_count')::integer = 0
      then 'PASS: PUBLIC, anon, and authenticated have no direct activity_log table privileges'
      else pg_catalog.format(
        'FAIL: direct activity_log client privilege count is %s',
        v_catalog ->> 'client_table_privilege_count'
      )
    end
  );

  v_results := pg_catalog.array_append(
    v_results,
    case
      when (v_catalog ->> 'matching_index_count')::integer = 1
      then 'PASS: valid btree index on activity_log (created_at, id) exists'
      else pg_catalog.format(
        'FAIL: matching (created_at, id) index count is %s',
        v_catalog ->> 'matching_index_count'
      )
    end
  );

  v_results := pg_catalog.array_append(
    v_results,
    case
      when (v_catalog ->> 'target_count')::integer = 1
       and not (v_catalog -> 'result_columns' ? 'changes')
      then 'PASS: result columns contain no raw changes column'
      else pg_catalog.format(
        'FAIL: result columns include raw changes: %s',
        v_catalog -> 'result_columns'
      )
    end
  );

  raise exception E'TEST RESULTS (expected 10 lines)\n%',
    pg_catalog.array_to_string(v_results, E'\n');
end
$test$;
```

## TEST 2: raw access and exact-task access

Expected result-line count: **28**.

Paste the whole script into the Dev SQL editor and choose **Run without RLS**. It creates uniquely tokenized Auth and application fixtures inside one transaction. The final `TEST RESULTS` exception is intentional and aborts the transaction, so every fixture rolls back.

```sql
begin;

do $test$
declare
  v_token text := pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
  v_results text[] := array[]::text[];
  v_failure_states text[] := array[]::text[];
  v_failure_messages text[] := array[]::text[];
  v_expected_failure_count integer := 12;
  v_index integer;
  v_ok boolean;
  v_state text;
  v_message text;
  v_select_denied boolean;
  v_insert_denied boolean;
  v_update_denied boolean;
  v_delete_denied boolean;
  v_log_count integer;
  v_trigger_ok boolean;
  v_reader_json jsonb;
  v_not_null_arrays text[];

  v_admin uuid := pg_catalog.gen_random_uuid();
  v_coadmin_a uuid := pg_catalog.gen_random_uuid();
  v_coadmin_b uuid := pg_catalog.gen_random_uuid();
  v_primary uuid := pg_catalog.gen_random_uuid();
  v_assist uuid := pg_catalog.gen_random_uuid();
  v_unassigned uuid := pg_catalog.gen_random_uuid();
  v_allowed_viewer uuid := pg_catalog.gen_random_uuid();
  v_volunteer uuid := pg_catalog.gen_random_uuid();
  v_former_assignee uuid := pg_catalog.gen_random_uuid();
  v_archive_viewer uuid := pg_catalog.gen_random_uuid();
  v_inactive uuid := pg_catalog.gen_random_uuid();
  v_profileless uuid := pg_catalog.gen_random_uuid();

  v_committee_a uuid := pg_catalog.gen_random_uuid();
  v_committee_b uuid := pg_catalog.gen_random_uuid();
  v_active_event uuid := pg_catalog.gen_random_uuid();
  v_draft_event uuid := pg_catalog.gen_random_uuid();
  v_archived_event uuid := pg_catalog.gen_random_uuid();
  v_public_task uuid := pg_catalog.gen_random_uuid();
  v_confidential_task uuid := pg_catalog.gen_random_uuid();
  v_draft_task uuid := pg_catalog.gen_random_uuid();
  v_archived_task uuid := pg_catalog.gen_random_uuid();
  v_deleted_task uuid := pg_catalog.gen_random_uuid();
  v_unknown_task uuid := pg_catalog.gen_random_uuid();

  v_raw_user_ids uuid[];
  v_raw_labels text[];
  v_global_success_ids uuid[];
  v_global_success_labels text[];
  v_global_failure_ids uuid[];
  v_global_failure_labels text[];
  v_exact_success_user_ids uuid[];
  v_exact_success_task_ids uuid[];
  v_exact_success_labels text[];
  v_exact_failure_user_ids uuid[];
  v_exact_failure_task_ids uuid[];
  v_exact_failure_labels text[];
begin
  if current_user <> 'postgres' then
    raise exception 'TEST 2 must run without RLS as postgres; current_user is %.',
      current_user;
  end if;

  insert into auth.users (
    id,
    instance_id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change_token_current,
    phone_change_token,
    reauthentication_token,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  )
  select
    fixture.id,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated',
    'authenticated',
    pg_catalog.format(
      'step12-t2-%s-%s@example.test',
      v_token,
      fixture.position
    ),
    '',
    pg_catalog.clock_timestamp(),
    pg_catalog.format('%s-confirm-%s', v_token, fixture.position),
    pg_catalog.format('%s-recover-%s', v_token, fixture.position),
    pg_catalog.format('%s-email-new-%s', v_token, fixture.position),
    pg_catalog.format('%s-email-current-%s', v_token, fixture.position),
    pg_catalog.format('%s-phone-%s', v_token, fixture.position),
    pg_catalog.format('%s-reauth-%s', v_token, fixture.position),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp()
  from pg_catalog.unnest(array[
    v_admin,
    v_coadmin_a,
    v_coadmin_b,
    v_primary,
    v_assist,
    v_unassigned,
    v_allowed_viewer,
    v_volunteer,
    v_former_assignee,
    v_archive_viewer,
    v_inactive,
    v_profileless
  ]::uuid[]) with ordinality as fixture(id, position);

  insert into public.committees (id, name)
  values
    (v_committee_a, 'Step 12 T2 A ' || v_token),
    (v_committee_b, 'Step 12 T2 B ' || v_token);

  perform pg_catalog.set_config(
    'ceit_connect.officer_writer',
    'invite_new_officer',
    true
  );
  insert into public.users (
    id,
    email,
    full_name,
    role,
    committee_id,
    is_active
  )
  values
    (
      v_admin,
      pg_catalog.format('step12-t2-%s-1@example.test', v_token),
      'Step 12 T2 Admin ' || v_token,
      'Admin',
      null,
      true
    ),
    (
      v_coadmin_a,
      pg_catalog.format('step12-t2-%s-2@example.test', v_token),
      'Step 12 T2 Co-Admin A ' || v_token,
      'Co-Admin',
      v_committee_a,
      true
    ),
    (
      v_coadmin_b,
      pg_catalog.format('step12-t2-%s-3@example.test', v_token),
      'Step 12 T2 Co-Admin B ' || v_token,
      'Co-Admin',
      v_committee_b,
      true
    );
  perform pg_catalog.set_config('ceit_connect.officer_writer', '', true);

  insert into public.users (
    id,
    email,
    full_name,
    role,
    committee_id,
    is_active
  )
  values
    (v_primary, pg_catalog.format('step12-t2-%s-4@example.test', v_token), 'Step 12 T2 Primary ' || v_token, 'Member', v_committee_a, true),
    (v_assist, pg_catalog.format('step12-t2-%s-5@example.test', v_token), 'Step 12 T2 Assist ' || v_token, 'Member', v_committee_a, true),
    (v_unassigned, pg_catalog.format('step12-t2-%s-6@example.test', v_token), 'Step 12 T2 Unassigned ' || v_token, 'Member', v_committee_a, true),
    (v_allowed_viewer, pg_catalog.format('step12-t2-%s-7@example.test', v_token), 'Step 12 T2 Allowed Viewer ' || v_token, 'Member', v_committee_a, true),
    (v_volunteer, pg_catalog.format('step12-t2-%s-8@example.test', v_token), 'Step 12 T2 Volunteer ' || v_token, 'Member', v_committee_b, true),
    (v_former_assignee, pg_catalog.format('step12-t2-%s-9@example.test', v_token), 'Step 12 T2 Former Assignee ' || v_token, 'Member', v_committee_a, true),
    (v_archive_viewer, pg_catalog.format('step12-t2-%s-10@example.test', v_token), 'Step 12 T2 Archive Viewer ' || v_token, 'Member', v_committee_b, true),
    (v_inactive, pg_catalog.format('step12-t2-%s-11@example.test', v_token), 'Step 12 T2 Inactive ' || v_token, 'Member', v_committee_a, false);

  insert into public.events (
    id,
    name,
    start_date,
    end_date,
    status,
    created_by
  )
  values
    (v_active_event, 'Step 12 T2 Active ' || v_token, current_date, current_date + 1, 'Active', v_admin),
    (v_draft_event, 'Step 12 T2 Draft ' || v_token, current_date, current_date + 1, 'Draft', v_admin),
    (v_archived_event, 'Step 12 T2 Archive ' || v_token, current_date, current_date + 1, 'Active', v_admin);

  perform pg_catalog.set_config(
    'request.jwt.claim.sub',
    v_admin::text,
    true
  );
  perform pg_catalog.set_config(
    'request.jwt.claim.role',
    'authenticated',
    true
  );
  perform pg_catalog.set_config(
    'ceit_connect.task_assignee_writer',
    'create_event_with_tasks',
    true
  );

  insert into public.tasks (
    id,
    event_id,
    committee_id,
    title,
    description,
    phase,
    status,
    priority,
    task_type,
    primary_assignees,
    assist_assignees,
    is_confidential,
    request_backup,
    allowed_viewers,
    created_by,
    sort_order
  )
  values
    (
      v_public_task,
      v_active_event,
      v_committee_a,
      'Step 12 T2 Public ' || v_token,
      'Public exact-access fixture',
      'Execution',
      'To Do',
      'Medium',
      'Deliverable',
      '{}'::uuid[],
      '{}'::uuid[],
      false,
      true,
      '{}'::uuid[],
      v_admin,
      1024
    ),
    (
      v_confidential_task,
      v_active_event,
      v_committee_a,
      'Step 12 T2 Confidential ' || v_token,
      'Confidential exact-access fixture',
      'Execution',
      'To Do',
      'High',
      'Deliverable',
      array[v_primary]::uuid[],
      array[v_assist, v_former_assignee]::uuid[],
      true,
      false,
      array[v_allowed_viewer]::uuid[],
      v_admin,
      2048
    ),
    (
      v_deleted_task,
      v_active_event,
      v_committee_b,
      'Step 12 T2 Deleted ' || v_token,
      'Deletion and ON DELETE SET NULL fixture',
      'Execution',
      'To Do',
      'Low',
      'Deliverable',
      '{}'::uuid[],
      '{}'::uuid[],
      false,
      false,
      '{}'::uuid[],
      v_admin,
      3072
    ),
    (
      v_draft_task,
      v_draft_event,
      v_committee_b,
      'Step 12 T2 Draft Task ' || v_token,
      'Draft-event fixture',
      'Planning',
      'To Do',
      'Medium',
      'Deliverable',
      '{}'::uuid[],
      '{}'::uuid[],
      false,
      false,
      '{}'::uuid[],
      v_admin,
      1024
    ),
    (
      v_archived_task,
      v_archived_event,
      v_committee_b,
      'Step 12 T2 Archived Confidential ' || v_token,
      'Archive-only viewer fixture',
      'Archive',
      'Completed',
      'Medium',
      'Deliverable',
      '{}'::uuid[],
      '{}'::uuid[],
      true,
      false,
      '{}'::uuid[],
      v_admin,
      1024
    );

  perform pg_catalog.set_config(
    'ceit_connect.task_assignee_writer',
    '',
    true
  );
  set constraints all immediate;

  insert into public.task_volunteers (task_id, user_id)
  values (v_public_task, v_volunteer);

  perform pg_catalog.set_config(
    'ceit_connect.task_assignee_writer',
    'edit_active_event_task',
    true
  );
  update public.tasks
  set title = title || ' updated',
      assist_assignees = array[v_assist]::uuid[]
  where id = v_confidential_task;

  update public.tasks
  set description = 'Public fixture changed by postgres'
  where id = v_public_task;
  perform pg_catalog.set_config(
    'ceit_connect.task_assignee_writer',
    '',
    true
  );
  set constraints all immediate;

  delete from public.tasks
  where id = v_deleted_task;
  set constraints all immediate;

  update public.events
  set status = 'Archived'
  where id = v_archived_event;
  set constraints all immediate;

  insert into public.archived_task_viewers (
    task_id,
    user_id,
    granted_by
  )
  values (v_archived_task, v_archive_viewer, v_admin);

  select pg_catalog.count(*)::integer
  into v_log_count
  from public.activity_log as log_row
  where (
    log_row.action in ('INSERT', 'DELETE')
    and log_row.changes ->> 'title' like 'Step 12 T2 %' || v_token || '%'
  ) or (
    log_row.action = 'UPDATE'
    and log_row.changes -> 'new' ->> 'title' like 'Step 12 T2 %' || v_token || '%'
  );

  select
    v_log_count >= 8
    and not exists (
      select 1 from public.tasks where id = v_deleted_task
    )
    and exists (
      select 1
      from public.activity_log as log_row
      where log_row.action = 'INSERT'
        and log_row.changes ->> 'id' = v_deleted_task::text
        and log_row.task_id is null
    )
    and exists (
      select 1
      from public.activity_log as log_row
      where log_row.action = 'DELETE'
        and log_row.changes ->> 'id' = v_deleted_task::text
        and log_row.task_id is null
    )
  into v_trigger_ok;

  v_raw_user_ids := array[
    v_admin,
    v_coadmin_a,
    v_coadmin_b,
    v_unassigned,
    v_inactive,
    v_profileless
  ];
  v_raw_labels := array[
    'Admin',
    'Co-Admin A',
    'Co-Admin B',
    'Member',
    'inactive Member',
    'profile-less authenticated user'
  ];

  for v_index in 1..pg_catalog.array_length(v_raw_user_ids, 1) loop
    execute 'set local role authenticated';
    perform pg_catalog.set_config(
      'request.jwt.claim.sub',
      v_raw_user_ids[v_index]::text,
      true
    );
    perform pg_catalog.set_config(
      'request.jwt.claim.role',
      'authenticated',
      true
    );

    v_select_denied := false;
    v_insert_denied := false;
    v_update_denied := false;
    v_delete_denied := false;

    begin
      perform 1 from public.activity_log limit 1;
    exception
      when insufficient_privilege then v_select_denied := true;
      when others then null;
    end;

    begin
      insert into public.activity_log (action, changes)
      values ('INSERT', pg_catalog.jsonb_build_object('token', v_token));
    exception
      when insufficient_privilege then v_insert_denied := true;
      when others then null;
    end;

    begin
      update public.activity_log
      set action = action
      where false;
    exception
      when insufficient_privilege then v_update_denied := true;
      when others then null;
    end;

    begin
      delete from public.activity_log
      where false;
    exception
      when insufficient_privilege then v_delete_denied := true;
      when others then null;
    end;

    execute 'reset role';

    v_results := pg_catalog.array_append(
      v_results,
      case
        when v_select_denied
         and v_insert_denied
         and v_update_denied
         and v_delete_denied
        then pg_catalog.format(
          'PASS: %s direct activity_log SELECT/INSERT/UPDATE/DELETE are denied',
          v_raw_labels[v_index]
        )
        else pg_catalog.format(
          'FAIL: %s raw denials select=%s insert=%s update=%s delete=%s',
          v_raw_labels[v_index],
          v_select_denied,
          v_insert_denied,
          v_update_denied,
          v_delete_denied
        )
      end
    );
  end loop;

  v_results := pg_catalog.array_append(
    v_results,
    case
      when v_trigger_ok
      then pg_catalog.format(
        'PASS: postgres task changes wrote %s trigger rows and task deletion nulled historical task_id values',
        v_log_count
      )
      else pg_catalog.format(
        'FAIL: trigger/deletion check failed (matching log rows=%s)',
        v_log_count
      )
    end
  );

  v_global_success_ids := array[v_admin, v_coadmin_a, v_coadmin_b];
  v_global_success_labels := array['Admin', 'Co-Admin A', 'Co-Admin B'];

  for v_index in 1..pg_catalog.array_length(v_global_success_ids, 1) loop
    execute 'set local role authenticated';
    perform pg_catalog.set_config(
      'request.jwt.claim.sub',
      v_global_success_ids[v_index]::text,
      true
    );
    begin
      select exists (
        select 1
        from public.list_activity_log() as reader_row
        where reader_row.activity_id is not null
      ) into v_ok;
    exception
      when others then v_ok := false;
    end;
    execute 'reset role';

    v_results := pg_catalog.array_append(
      v_results,
      case
        when v_ok
        then pg_catalog.format(
          'PASS: %s can call list_activity_log() without a task id',
          v_global_success_labels[v_index]
        )
        else pg_catalog.format(
          'FAIL: %s could not read the global activity log',
          v_global_success_labels[v_index]
        )
      end
    );
  end loop;

  v_global_failure_ids := array[v_unassigned, v_inactive, v_profileless];
  v_global_failure_labels := array[
    'Member global call',
    'inactive global call',
    'profile-less global call'
  ];

  for v_index in 1..pg_catalog.array_length(v_global_failure_ids, 1) loop
    execute 'set local role authenticated';
    perform pg_catalog.set_config(
      'request.jwt.claim.sub',
      v_global_failure_ids[v_index]::text,
      true
    );
    v_state := null;
    v_message := null;
    begin
      perform 1 from public.list_activity_log();
    exception
      when others then
        get stacked diagnostics
          v_state = returned_sqlstate,
          v_message = message_text;
    end;
    execute 'reset role';

    if v_state is not null then
      v_failure_states := pg_catalog.array_append(v_failure_states, v_state);
      v_failure_messages := pg_catalog.array_append(v_failure_messages, v_message);
    end if;

    v_results := pg_catalog.array_append(
      v_results,
      case
        when v_state = 'CAL01'
         and v_message = 'Activity history is unavailable.'
        then 'PASS: ' || v_global_failure_labels[v_index] || ' fails with CAL01'
        else pg_catalog.format(
          'FAIL: %s returned SQLSTATE=%s message=%s',
          v_global_failure_labels[v_index],
          coalesce(v_state, '<no error>'),
          coalesce(v_message, '<no error>')
        )
      end
    );
  end loop;

  v_exact_success_user_ids := array[v_primary, v_assist, v_admin];
  v_exact_success_task_ids := array[
    v_confidential_task,
    v_confidential_task,
    v_confidential_task
  ];
  v_exact_success_labels := array[
    'primary Member',
    'assist Member',
    'Admin'
  ];

  for v_index in 1..pg_catalog.array_length(v_exact_success_user_ids, 1) loop
    execute 'set local role authenticated';
    perform pg_catalog.set_config(
      'request.jwt.claim.sub',
      v_exact_success_user_ids[v_index]::text,
      true
    );
    begin
      select exists (
        select 1
        from public.list_activity_log(
          p_task_id => v_exact_success_task_ids[v_index]
        ) as reader_row
        where reader_row.activity_id is not null
      ) into v_ok;
    exception
      when others then v_ok := false;
    end;
    execute 'reset role';

    v_results := pg_catalog.array_append(
      v_results,
      case
        when v_ok
        then 'PASS: exact-task reader succeeds for ' || v_exact_success_labels[v_index]
        else 'FAIL: exact-task reader failed for ' || v_exact_success_labels[v_index]
      end
    );
  end loop;

  v_exact_failure_user_ids := array[
    v_unassigned,
    v_allowed_viewer,
    v_volunteer,
    v_former_assignee,
    v_archive_viewer,
    v_inactive,
    v_profileless,
    v_primary,
    v_primary
  ];
  v_exact_failure_task_ids := array[
    v_public_task,
    v_confidential_task,
    v_public_task,
    v_confidential_task,
    v_archived_task,
    v_confidential_task,
    v_confidential_task,
    v_unknown_task,
    v_deleted_task
  ];
  v_exact_failure_labels := array[
    'unassigned Member',
    'allowed-viewer-only Member',
    'volunteer Member',
    'former assignee',
    'archive-only viewer',
    'inactive Member',
    'profile-less authenticated user',
    'unknown task id',
    'deleted task id'
  ];

  for v_index in 1..pg_catalog.array_length(v_exact_failure_user_ids, 1) loop
    execute 'set local role authenticated';
    perform pg_catalog.set_config(
      'request.jwt.claim.sub',
      v_exact_failure_user_ids[v_index]::text,
      true
    );
    v_state := null;
    v_message := null;
    begin
      perform 1
      from public.list_activity_log(
        p_task_id => v_exact_failure_task_ids[v_index]
      );
    exception
      when others then
        get stacked diagnostics
          v_state = returned_sqlstate,
          v_message = message_text;
    end;
    execute 'reset role';

    if v_state is not null then
      v_failure_states := pg_catalog.array_append(v_failure_states, v_state);
      v_failure_messages := pg_catalog.array_append(v_failure_messages, v_message);
    end if;

    v_results := pg_catalog.array_append(
      v_results,
      case
        when v_state = 'CAL01'
         and v_message = 'Activity history is unavailable.'
        then 'PASS: exact-task reader rejects ' || v_exact_failure_labels[v_index] || ' with CAL01'
        else pg_catalog.format(
          'FAIL: %s returned SQLSTATE=%s message=%s',
          v_exact_failure_labels[v_index],
          coalesce(v_state, '<no error>'),
          coalesce(v_message, '<no error>')
        )
      end
    );
  end loop;

  select pg_catalog.array_agg(attribute.attname order by attribute.attname)
  into v_not_null_arrays
  from pg_catalog.pg_attribute as attribute
  where attribute.attrelid = 'public.tasks'::regclass
    and attribute.attname in ('primary_assignees', 'assist_assignees')
    and attribute.attnotnull
    and not attribute.attisdropped;

  if coalesce(
    pg_catalog.cardinality(v_not_null_arrays),
    0
  ) > 0 then
    v_results := pg_catalog.array_append(
      v_results,
      pg_catalog.format(
        'SKIP: NULL-array check is not applicable because these task columns are NOT NULL: %s',
        pg_catalog.array_to_string(v_not_null_arrays, ', ')
      )
    );
  else
    perform pg_catalog.set_config(
      'ceit_connect.task_assignee_writer',
      'edit_active_event_task',
      true
    );
    update public.tasks
    set primary_assignees = null,
        assist_assignees = null
    where id = v_public_task;
    perform pg_catalog.set_config(
      'ceit_connect.task_assignee_writer',
      '',
      true
    );
    set constraints all immediate;

    execute 'set local role authenticated';
    perform pg_catalog.set_config(
      'request.jwt.claim.sub',
      v_unassigned::text,
      true
    );
    v_state := null;
    v_message := null;
    begin
      perform 1
      from public.list_activity_log(p_task_id => v_public_task);
    exception
      when others then
        get stacked diagnostics
          v_state = returned_sqlstate,
          v_message = message_text;
    end;
    execute 'reset role';

    if v_state is not null then
      v_failure_states := pg_catalog.array_append(v_failure_states, v_state);
      v_failure_messages := pg_catalog.array_append(v_failure_messages, v_message);
    end if;
    v_expected_failure_count := v_expected_failure_count + 1;

    v_results := pg_catalog.array_append(
      v_results,
      case
        when v_state = 'CAL01'
         and v_message = 'Activity history is unavailable.'
        then 'PASS: nullable assignment arrays fail closed with CAL01'
        else pg_catalog.format(
          'FAIL: NULL-array call returned SQLSTATE=%s message=%s',
          coalesce(v_state, '<no error>'),
          coalesce(v_message, '<no error>')
        )
      end
    );
  end if;

  v_results := pg_catalog.array_append(
    v_results,
    case
      when pg_catalog.cardinality(v_failure_states) = v_expected_failure_count
       and not exists (
         select 1
         from pg_catalog.unnest(v_failure_states) as failure_state(value)
         where failure_state.value <> 'CAL01'
       )
       and not exists (
         select 1
         from pg_catalog.unnest(v_failure_messages) as failure_message(value)
         where failure_message.value <> 'Activity history is unavailable.'
       )
      then pg_catalog.format(
        'PASS: all %s reader failures use identical CAL01 and message text',
        v_expected_failure_count
      )
      else pg_catalog.format(
        'FAIL: reader failures differ (expected=%s states=%s messages=%s)',
        v_expected_failure_count,
        v_failure_states,
        v_failure_messages
      )
    end
  );

  execute 'set local role authenticated';
  perform pg_catalog.set_config(
    'request.jwt.claim.sub',
    v_admin::text,
    true
  );
  begin
    select pg_catalog.to_jsonb(reader_row)
    into v_reader_json
    from public.list_activity_log(
      p_task_id => v_confidential_task
    ) as reader_row
    where reader_row.activity_id is not null
    limit 1;
  exception
    when others then v_reader_json := null;
  end;
  execute 'reset role';

  v_results := pg_catalog.array_append(
    v_results,
    case
      when v_reader_json is not null
       and not (v_reader_json ? 'changes')
      then 'PASS: reader result contains no raw changes column'
      else pg_catalog.format(
        'FAIL: reader result is missing or exposes changes: %s',
        v_reader_json
      )
    end
  );

  raise exception E'TEST RESULTS (expected 28 lines)\n%',
    pg_catalog.array_to_string(v_results, E'\n');
end
$test$;
```

## TEST 3: global log shape, masking, deleted rows, actor labels, legacy snapshots

Expected result-line count: **8**.

Paste the whole script into the Dev SQL editor and choose **Run without RLS**. It creates uniquely tokenized Auth and application fixtures inside one transaction. The anonymized actor is produced through the project-approved `public.anonymize_former_member(uuid)` RPC, which sets `anonymized_at` through its guarded `ceit_connect.former_member_writer` path. The final `TEST RESULTS` exception is intentional and aborts the transaction, so every fixture and crafted legacy row rolls back.

```sql
begin;

do $test$
declare
  v_token text := pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
  v_results text[] := array[]::text[];
  v_base timestamptz := pg_catalog.clock_timestamp() + interval '10 years';
  v_cursor_id uuid := '00000000-0000-0000-0000-000000000000'::uuid;
  v_index integer;
  v_ok boolean;
  v_json jsonb;
  v_keys text[];
  v_presentation_text text;

  v_admin uuid := pg_catalog.gen_random_uuid();
  v_coadmin_a uuid := pg_catalog.gen_random_uuid();
  v_coadmin_b uuid := pg_catalog.gen_random_uuid();
  v_actor uuid := pg_catalog.gen_random_uuid();
  v_former_actor uuid := pg_catalog.gen_random_uuid();
  v_committee_a uuid := pg_catalog.gen_random_uuid();
  v_committee_b uuid := pg_catalog.gen_random_uuid();
  v_active_event uuid := pg_catalog.gen_random_uuid();
  v_draft_event uuid := pg_catalog.gen_random_uuid();
  v_archived_event uuid := pg_catalog.gen_random_uuid();
  v_missing_event uuid := pg_catalog.gen_random_uuid();
  v_live_public_task uuid := pg_catalog.gen_random_uuid();
  v_live_confidential_task uuid := pg_catalog.gen_random_uuid();
  v_draft_task uuid := pg_catalog.gen_random_uuid();
  v_reclassified_task uuid := pg_catalog.gen_random_uuid();
  v_archived_seed_task uuid := pg_catalog.gen_random_uuid();
  v_deleted_active_task uuid := pg_catalog.gen_random_uuid();
  v_deleted_archived_task uuid := pg_catalog.gen_random_uuid();
  v_deleted_draft_task uuid := pg_catalog.gen_random_uuid();
  v_deleted_missing_parent_task uuid := pg_catalog.gen_random_uuid();
  v_deleted_confidential_task uuid := pg_catalog.gen_random_uuid();
  v_later_deleted_task uuid := pg_catalog.gen_random_uuid();

  v_real_insert_id uuid := pg_catalog.gen_random_uuid();
  v_real_update_id uuid := pg_catalog.gen_random_uuid();
  v_real_delete_id uuid := pg_catalog.gen_random_uuid();
  v_confidential_id uuid := pg_catalog.gen_random_uuid();
  v_draft_id uuid := pg_catalog.gen_random_uuid();
  v_deleted_active_id uuid := pg_catalog.gen_random_uuid();
  v_deleted_archived_id uuid := pg_catalog.gen_random_uuid();
  v_deleted_draft_id uuid := pg_catalog.gen_random_uuid();
  v_deleted_missing_id uuid := pg_catalog.gen_random_uuid();
  v_deleted_confidential_id uuid := pg_catalog.gen_random_uuid();
  v_later_deleted_insert_id uuid := pg_catalog.gen_random_uuid();
  v_later_deleted_update_id uuid := pg_catalog.gen_random_uuid();
  v_former_actor_id uuid := pg_catalog.gen_random_uuid();
  v_null_actor_id uuid := pg_catalog.gen_random_uuid();
  v_legacy_with_updated_id uuid := pg_catalog.gen_random_uuid();
  v_legacy_without_updated_id uuid := pg_catalog.gen_random_uuid();
  v_legacy_older_id uuid := pg_catalog.gen_random_uuid();
  v_malformed_null_id uuid := pg_catalog.gen_random_uuid();
  v_malformed_string_id uuid := pg_catalog.gen_random_uuid();
  v_malformed_array_id uuid := pg_catalog.gen_random_uuid();
  v_malformed_update_no_old_id uuid := pg_catalog.gen_random_uuid();
  v_malformed_update_no_new_id uuid := pg_catalog.gen_random_uuid();
  v_malformed_title_number_id uuid := pg_catalog.gen_random_uuid();
  v_malformed_confidential_string_id uuid := pg_catalog.gen_random_uuid();
  v_malformed_task_uuid_id uuid := pg_catalog.gen_random_uuid();
  v_malformed_event_uuid_id uuid := pg_catalog.gen_random_uuid();
  v_malformed_committee_uuid_id uuid := pg_catalog.gen_random_uuid();
  v_malformed_empty_title_id uuid := pg_catalog.gen_random_uuid();
  v_malformed_long_title_id uuid := pg_catalog.gen_random_uuid();
  v_reclassified_history_id uuid := pg_catalog.gen_random_uuid();

  v_public_snapshot jsonb;
  v_update_old jsonb;
  v_update_new jsonb;
  v_confidential_snapshot jsonb;
  v_draft_snapshot jsonb;
  v_reclassified_snapshot jsonb;
  v_later_deleted_old jsonb;
  v_later_deleted_new jsonb;

  v_real_insert jsonb;
  v_real_update jsonb;
  v_real_delete jsonb;
  v_conf_admin jsonb;
  v_conf_coadmin_a jsonb;
  v_conf_coadmin_b jsonb;
  v_draft_admin jsonb;
  v_draft_coadmin_a jsonb;
  v_draft_coadmin_b jsonb;
  v_deleted_active jsonb;
  v_deleted_archived jsonb;
  v_deleted_draft jsonb;
  v_deleted_missing jsonb;
  v_deleted_confidential jsonb;
  v_later_deleted_insert jsonb;
  v_later_deleted_update jsonb;
  v_former_actor_row jsonb;
  v_null_actor_row jsonb;
  v_reclassified_row jsonb;
  v_admin_count integer;
  v_coadmin_b_count integer;
  v_access_admin text;
  v_access_coadmin_a text;
  v_access_coadmin_b text;
  v_legacy_ok boolean := true;
  v_malformed_ok boolean := true;
  v_legacy_ids uuid[];
  v_legacy_times timestamptz[];
  v_legacy_titles text[];
  v_malformed_ids uuid[];
  v_malformed_times timestamptz[];
begin
  if current_user <> 'postgres' then
    raise exception 'TEST 3 must run without RLS as postgres; current_user is %.',
      current_user;
  end if;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, confirmation_token, recovery_token,
    email_change_token_new, email_change_token_current,
    phone_change_token, reauthentication_token,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  )
  select
    fixture.id,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated',
    'authenticated',
    pg_catalog.format('step12-t3-%s-%s@example.test', v_token, fixture.position),
    '',
    pg_catalog.clock_timestamp(),
    pg_catalog.format('%s-confirm-%s', v_token, fixture.position),
    pg_catalog.format('%s-recover-%s', v_token, fixture.position),
    pg_catalog.format('%s-email-new-%s', v_token, fixture.position),
    pg_catalog.format('%s-email-current-%s', v_token, fixture.position),
    pg_catalog.format('%s-phone-%s', v_token, fixture.position),
    pg_catalog.format('%s-reauth-%s', v_token, fixture.position),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp()
  from pg_catalog.unnest(array[
    v_admin, v_coadmin_a, v_coadmin_b, v_actor, v_former_actor
  ]::uuid[]) with ordinality as fixture(id, position);

  insert into public.committees (id, name)
  values
    (v_committee_a, 'Step 12 T3 Committee A ' || v_token),
    (v_committee_b, 'Step 12 T3 Committee B ' || v_token);

  perform pg_catalog.set_config(
    'ceit_connect.officer_writer', 'invite_new_officer', true
  );
  insert into public.users (
    id, email, full_name, role, committee_id, is_active
  )
  values
    (v_admin, pg_catalog.format('step12-t3-%s-1@example.test', v_token), 'Step 12 T3 Admin ' || v_token, 'Admin', null, true),
    (v_coadmin_a, pg_catalog.format('step12-t3-%s-2@example.test', v_token), 'Step 12 T3 Co-Admin A ' || v_token, 'Co-Admin', v_committee_a, true),
    (v_coadmin_b, pg_catalog.format('step12-t3-%s-3@example.test', v_token), 'Step 12 T3 Co-Admin B ' || v_token, 'Co-Admin', v_committee_b, true);
  perform pg_catalog.set_config('ceit_connect.officer_writer', '', true);

  insert into public.users (
    id, email, full_name, role, committee_id, is_active
  )
  values
    (v_actor, pg_catalog.format('step12-t3-%s-4@example.test', v_token), 'Step 12 T3 Ordinary Actor ' || v_token, 'Member', v_committee_b, true),
    (v_former_actor, pg_catalog.format('step12-t3-%s-5@example.test', v_token), 'Step 12 T3 Former Actor Before ' || v_token, 'Member', v_committee_b, false);

  insert into public.events (
    id, name, start_date, end_date, status, created_by
  )
  values
    (v_active_event, 'Step 12 T3 Active Event ' || v_token, current_date, current_date + 1, 'Active', v_admin),
    (v_draft_event, 'Step 12 T3 Draft Event ' || v_token, current_date, current_date + 1, 'Draft', v_admin),
    (v_archived_event, 'Step 12 T3 Archived Event ' || v_token, current_date, current_date + 1, 'Active', v_admin);

  perform pg_catalog.set_config('request.jwt.claim.sub', v_actor::text, true);
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  perform pg_catalog.set_config(
    'ceit_connect.task_assignee_writer', 'create_event_with_tasks', true
  );
  insert into public.tasks (
    id, event_id, committee_id, title, description, phase, status,
    priority, task_type, primary_assignees, assist_assignees,
    is_confidential, request_backup, allowed_viewers, created_by, sort_order
  )
  values
    (v_live_public_task, v_active_event, v_committee_b, 'Step 12 T3 Live Public ' || v_token, 'Public shape fixture', 'Execution', 'To Do', 'Medium', 'Deliverable', '{}'::uuid[], '{}'::uuid[], false, false, '{}'::uuid[], v_admin, 1024),
    (v_live_confidential_task, v_active_event, v_committee_a, 'Step 12 T3 Live Confidential ' || v_token, 'Masking fixture', 'Execution', 'To Do', 'High', 'Deliverable', '{}'::uuid[], '{}'::uuid[], true, false, '{}'::uuid[], v_admin, 2048),
    (v_draft_task, v_draft_event, v_committee_a, 'Step 12 T3 Draft Task ' || v_token, 'Draft fixture', 'Planning', 'To Do', 'Medium', 'Deliverable', '{}'::uuid[], '{}'::uuid[], false, false, '{}'::uuid[], v_admin, 1024),
    (v_reclassified_task, v_active_event, v_committee_b, 'Step 12 T3 Current Public Title ' || v_token, 'Historical confidentiality fixture', 'Execution', 'To Do', 'Medium', 'Deliverable', '{}'::uuid[], '{}'::uuid[], true, false, '{}'::uuid[], v_admin, 3072),
    (v_archived_seed_task, v_archived_event, v_committee_b, 'Step 12 T3 Archived Seed ' || v_token, 'Keeps the event valid before archival', 'Execution', 'To Do', 'Medium', 'Deliverable', '{}'::uuid[], '{}'::uuid[], false, false, '{}'::uuid[], v_admin, 1024);
  perform pg_catalog.set_config('ceit_connect.task_assignee_writer', '', true);
  set constraints all immediate;

  perform pg_catalog.set_config(
    'ceit_connect.task_assignee_writer', 'edit_active_event_task', true
  );
  update public.tasks
  set is_confidential = false
  where id = v_reclassified_task;
  perform pg_catalog.set_config('ceit_connect.task_assignee_writer', '', true);
  set constraints all immediate;

  update public.events
  set status = 'Archived'
  where id = v_archived_event;
  set constraints all immediate;

  v_public_snapshot := pg_catalog.jsonb_build_object(
    'id', v_live_public_task::text,
    'event_id', v_active_event::text,
    'committee_id', v_committee_b::text,
    'title', 'Step 12 T3 Live Public ' || v_token,
    'is_confidential', false,
    'status', 'To Do',
    'primary_assignees', pg_catalog.to_jsonb('{}'::uuid[]),
    'assist_assignees', pg_catalog.to_jsonb('{}'::uuid[])
  );
  v_update_old := v_public_snapshot;
  v_update_new := v_public_snapshot || pg_catalog.jsonb_build_object(
    'title', 'Step 12 T3 Live Public Updated ' || v_token,
    'status', 'In Progress',
    'primary_assignees', pg_catalog.to_jsonb(array[v_actor]::uuid[])
  );
  v_confidential_snapshot := pg_catalog.jsonb_build_object(
    'id', v_live_confidential_task::text,
    'event_id', v_active_event::text,
    'committee_id', v_committee_a::text,
    'title', 'Step 12 T3 Live Confidential ' || v_token,
    'is_confidential', true
  );
  v_draft_snapshot := pg_catalog.jsonb_build_object(
    'id', v_draft_task::text,
    'event_id', v_draft_event::text,
    'committee_id', v_committee_a::text,
    'title', 'Step 12 T3 Draft Task ' || v_token,
    'is_confidential', false
  );
  v_reclassified_snapshot := pg_catalog.jsonb_build_object(
    'id', v_reclassified_task::text,
    'event_id', v_active_event::text,
    'committee_id', v_committee_b::text,
    'title', 'Step 12 T3 Old Confidential Title ' || v_token,
    'is_confidential', true
  );
  v_later_deleted_old := pg_catalog.jsonb_build_object(
    'id', v_later_deleted_task::text,
    'event_id', v_active_event::text,
    'committee_id', v_committee_b::text,
    'title', 'Step 12 T3 Later Deleted Old ' || v_token,
    'is_confidential', false
  );
  v_later_deleted_new := v_later_deleted_old || pg_catalog.jsonb_build_object(
    'title', 'Step 12 T3 Later Deleted New ' || v_token
  );

  insert into public.activity_log (
    id, task_id, user_id, action, changes, created_at
  )
  values
    (v_real_insert_id, v_live_public_task, v_actor, 'INSERT', v_public_snapshot, v_base + interval '1 second'),
    (v_real_update_id, v_live_public_task, v_actor, 'UPDATE', pg_catalog.jsonb_build_object('old', v_update_old, 'new', v_update_new), v_base + interval '2 seconds'),
    (v_real_delete_id, v_live_public_task, v_actor, 'DELETE', v_public_snapshot, v_base + interval '3 seconds'),
    (v_confidential_id, v_live_confidential_task, v_actor, 'INSERT', v_confidential_snapshot, v_base + interval '4 seconds'),
    (v_draft_id, v_draft_task, v_actor, 'INSERT', v_draft_snapshot, v_base + interval '5 seconds'),
    (v_deleted_active_id, null, v_actor, 'DELETE', pg_catalog.jsonb_build_object('id', v_deleted_active_task::text, 'event_id', v_active_event::text, 'committee_id', v_committee_b::text, 'title', 'Step 12 T3 Deleted Active ' || v_token, 'is_confidential', false), v_base + interval '6 seconds'),
    (v_deleted_archived_id, null, v_actor, 'DELETE', pg_catalog.jsonb_build_object('id', v_deleted_archived_task::text, 'event_id', v_archived_event::text, 'committee_id', v_committee_b::text, 'title', 'Step 12 T3 Deleted Archived ' || v_token, 'is_confidential', false), v_base + interval '7 seconds'),
    (v_deleted_draft_id, null, v_actor, 'DELETE', pg_catalog.jsonb_build_object('id', v_deleted_draft_task::text, 'event_id', v_draft_event::text, 'committee_id', v_committee_a::text, 'title', 'Step 12 T3 Deleted Draft ' || v_token, 'is_confidential', false), v_base + interval '8 seconds'),
    (v_deleted_missing_id, null, v_actor, 'DELETE', pg_catalog.jsonb_build_object('id', v_deleted_missing_parent_task::text, 'event_id', v_missing_event::text, 'committee_id', v_committee_b::text, 'title', 'Step 12 T3 Deleted Missing Parent ' || v_token, 'is_confidential', false), v_base + interval '9 seconds'),
    (v_deleted_confidential_id, null, v_actor, 'DELETE', pg_catalog.jsonb_build_object('id', v_deleted_confidential_task::text, 'event_id', v_active_event::text, 'committee_id', v_committee_b::text, 'title', 'Step 12 T3 Deleted Confidential ' || v_token, 'is_confidential', true), v_base + interval '10 seconds'),
    (v_later_deleted_insert_id, null, v_actor, 'INSERT', v_later_deleted_old, v_base + interval '11 seconds'),
    (v_later_deleted_update_id, null, v_actor, 'UPDATE', pg_catalog.jsonb_build_object('old', v_later_deleted_old, 'new', v_later_deleted_new), v_base + interval '12 seconds'),
    (v_former_actor_id, v_live_public_task, v_former_actor, 'INSERT', v_public_snapshot, v_base + interval '13 seconds'),
    (v_null_actor_id, v_live_public_task, null, 'INSERT', v_public_snapshot, v_base + interval '14 seconds'),
    (v_legacy_with_updated_id, v_live_public_task, v_actor, 'INSERT', v_public_snapshot || pg_catalog.jsonb_build_object('title', 'Step 12 T3 Legacy With Updated ' || v_token, 'updated_at', (v_base - interval '1 day')::text), v_base + interval '15 seconds'),
    (v_legacy_without_updated_id, v_live_public_task, v_actor, 'INSERT', v_public_snapshot || pg_catalog.jsonb_build_object('title', 'Step 12 T3 Legacy Without Updated ' || v_token), v_base + interval '16 seconds'),
    (v_legacy_older_id, v_live_public_task, v_actor, 'INSERT', pg_catalog.jsonb_build_object('id', v_live_public_task::text, 'event_id', v_active_event::text, 'committee_id', v_committee_b::text, 'title', 'Step 12 T3 Legacy Older Columns ' || v_token, 'is_confidential', false), v_base + interval '17 seconds'),
    (v_malformed_null_id, v_live_public_task, v_actor, 'INSERT', null, v_base + interval '18 seconds'),
    (v_malformed_string_id, v_live_public_task, v_actor, 'INSERT', '"legacy"'::jsonb, v_base + interval '19 seconds'),
    (v_malformed_array_id, v_live_public_task, v_actor, 'INSERT', '[]'::jsonb, v_base + interval '20 seconds'),
    (v_malformed_update_no_old_id, v_live_public_task, v_actor, 'UPDATE', pg_catalog.jsonb_build_object('new', v_public_snapshot), v_base + interval '21 seconds'),
    (v_malformed_update_no_new_id, v_live_public_task, v_actor, 'UPDATE', pg_catalog.jsonb_build_object('old', v_public_snapshot), v_base + interval '22 seconds'),
    (v_malformed_title_number_id, v_live_public_task, v_actor, 'INSERT', pg_catalog.jsonb_set(v_public_snapshot, '{title}', '7'::jsonb), v_base + interval '23 seconds'),
    (v_malformed_confidential_string_id, v_live_public_task, v_actor, 'INSERT', pg_catalog.jsonb_set(v_public_snapshot, '{is_confidential}', '"false"'::jsonb), v_base + interval '24 seconds'),
    (v_malformed_task_uuid_id, v_live_public_task, v_actor, 'INSERT', pg_catalog.jsonb_set(v_public_snapshot, '{id}', '"not-a-uuid"'::jsonb), v_base + interval '25 seconds'),
    (v_malformed_event_uuid_id, v_live_public_task, v_actor, 'INSERT', pg_catalog.jsonb_set(v_public_snapshot, '{event_id}', '"not-a-uuid"'::jsonb), v_base + interval '26 seconds'),
    (v_malformed_committee_uuid_id, v_live_public_task, v_actor, 'INSERT', pg_catalog.jsonb_set(v_public_snapshot, '{committee_id}', '"not-a-uuid"'::jsonb), v_base + interval '27 seconds'),
    (v_malformed_empty_title_id, v_live_public_task, v_actor, 'INSERT', pg_catalog.jsonb_set(v_public_snapshot, '{title}', '""'::jsonb), v_base + interval '28 seconds'),
    (v_malformed_long_title_id, v_live_public_task, v_actor, 'INSERT', pg_catalog.jsonb_set(v_public_snapshot, '{title}', pg_catalog.to_jsonb(pg_catalog.repeat('x', 1001))), v_base + interval '29 seconds'),
    (v_reclassified_history_id, v_reclassified_task, v_actor, 'INSERT', v_reclassified_snapshot, v_base + interval '30 seconds');

  execute 'set local role authenticated';
  perform pg_catalog.set_config('request.jwt.claim.sub', v_admin::text, true);
  perform 1 from public.anonymize_former_member(v_former_actor);
  execute 'reset role';

  -- Impersonate Co-Admin B for the three real public rows.
  execute 'set local role authenticated';
  perform pg_catalog.set_config('request.jwt.claim.sub', v_coadmin_b::text, true);
  select pg_catalog.to_jsonb(row_value) into v_real_insert
  from public.list_activity_log(p_sort => 'oldest', p_cursor_created_at => v_base + interval '1 second' - interval '1 microsecond', p_cursor_id => v_cursor_id, p_page_size => 20) row_value
  where row_value.activity_id = v_real_insert_id;
  select pg_catalog.to_jsonb(row_value) into v_real_update
  from public.list_activity_log(p_sort => 'oldest', p_cursor_created_at => v_base + interval '2 seconds' - interval '1 microsecond', p_cursor_id => v_cursor_id, p_page_size => 20) row_value
  where row_value.activity_id = v_real_update_id;
  select pg_catalog.to_jsonb(row_value) into v_real_delete
  from public.list_activity_log(p_sort => 'oldest', p_cursor_created_at => v_base + interval '3 seconds' - interval '1 microsecond', p_cursor_id => v_cursor_id, p_page_size => 20) row_value
  where row_value.activity_id = v_real_delete_id;
  execute 'reset role';

  v_presentation_text := pg_catalog.concat_ws(
    ' ',
    v_real_insert ->> 'task_title', v_real_insert ->> 'event_name',
    v_real_insert ->> 'committee_name', v_real_insert ->> 'actor_name',
    v_real_update ->> 'task_title', v_real_update ->> 'event_name',
    v_real_update ->> 'committee_name', v_real_update ->> 'actor_name',
    v_real_delete ->> 'task_title', v_real_delete ->> 'event_name',
    v_real_delete ->> 'committee_name', v_real_delete ->> 'actor_name',
    v_real_insert ->> 'change_summary', v_real_update ->> 'change_summary',
    v_real_delete ->> 'change_summary'
  );
  v_ok := v_real_insert is not null
    and v_real_update is not null
    and v_real_delete is not null
    and (v_real_insert ->> 'is_masked')::boolean is false
    and (v_real_update ->> 'is_masked')::boolean is false
    and (v_real_delete ->> 'is_masked')::boolean is false
    and v_real_insert ->> 'task_title' = 'Step 12 T3 Live Public ' || v_token
    and v_real_insert ->> 'event_name' = 'Step 12 T3 Active Event ' || v_token
    and v_real_insert ->> 'committee_name' = 'Step 12 T3 Committee B ' || v_token
    and v_real_insert ->> 'actor_name' = 'Step 12 T3 Ordinary Actor ' || v_token
    and v_real_insert -> 'change_summary' = '["Task created"]'::jsonb
    and v_real_delete -> 'change_summary' = '["Task deleted"]'::jsonb
    and v_real_update -> 'change_summary' = '["Title updated","Status updated","Assignments updated"]'::jsonb
    and v_presentation_text not like '%@%'
    and v_presentation_text !~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
    and not (v_real_insert ?| array['changes', 'primary_assignees', 'assist_assignees', 'allowed_viewers', 'user_id', 'email'])
    and not (v_real_update ?| array['changes', 'primary_assignees', 'assist_assignees', 'allowed_viewers', 'user_id', 'email'])
    and not (v_real_delete ?| array['changes', 'primary_assignees', 'assist_assignees', 'allowed_viewers', 'user_id', 'email']);
  v_results := pg_catalog.array_append(v_results, case when v_ok then 'PASS: 1 real rows expose safe labels and presentation fields only' else 'FAIL: 1 subcases: INSERT shape/labels; UPDATE fixed labels; DELETE fixed label; presentation-field leak check' end);

  -- Read the confidential row as Admin, owning Co-Admin A, and other Co-Admin B.
  execute 'set local role authenticated';
  perform pg_catalog.set_config('request.jwt.claim.sub', v_admin::text, true);
  select pg_catalog.to_jsonb(row_value) into v_conf_admin
  from public.list_activity_log(p_sort => 'oldest', p_cursor_created_at => v_base + interval '4 seconds' - interval '1 microsecond', p_cursor_id => v_cursor_id, p_page_size => 20) row_value
  where row_value.activity_id = v_confidential_id;
  select pg_catalog.count(*)::integer into v_admin_count
  from public.list_activity_log(p_sort => 'oldest', p_cursor_created_at => v_base - interval '1 microsecond', p_cursor_id => v_cursor_id, p_page_size => 20);
  execute 'reset role';

  execute 'set local role authenticated';
  perform pg_catalog.set_config('request.jwt.claim.sub', v_coadmin_a::text, true);
  select pg_catalog.to_jsonb(row_value) into v_conf_coadmin_a
  from public.list_activity_log(p_sort => 'oldest', p_cursor_created_at => v_base + interval '4 seconds' - interval '1 microsecond', p_cursor_id => v_cursor_id, p_page_size => 20) row_value
  where row_value.activity_id = v_confidential_id;
  execute 'reset role';

  execute 'set local role authenticated';
  perform pg_catalog.set_config('request.jwt.claim.sub', v_coadmin_b::text, true);
  select pg_catalog.to_jsonb(row_value) into v_conf_coadmin_b
  from public.list_activity_log(p_sort => 'oldest', p_cursor_created_at => v_base + interval '4 seconds' - interval '1 microsecond', p_cursor_id => v_cursor_id, p_page_size => 20) row_value
  where row_value.activity_id = v_confidential_id;
  select pg_catalog.count(*)::integer into v_coadmin_b_count
  from public.list_activity_log(p_sort => 'oldest', p_cursor_created_at => v_base - interval '1 microsecond', p_cursor_id => v_cursor_id, p_page_size => 20);
  execute 'reset role';

  v_ok := v_conf_admin is not null
    and v_conf_coadmin_a is not null
    and v_conf_coadmin_b is not null
    and (v_conf_admin ->> 'is_masked')::boolean is false
    and (v_conf_coadmin_a ->> 'is_masked')::boolean is false
    and v_conf_admin ->> 'task_title' = 'Step 12 T3 Live Confidential ' || v_token
    and v_conf_coadmin_a ->> 'task_title' = 'Step 12 T3 Live Confidential ' || v_token
    and (v_conf_coadmin_b ->> 'is_masked')::boolean is true
    and v_conf_coadmin_b ->> 'task_title' = 'Confidential Task'
    and v_conf_coadmin_b ->> 'task_id' is null
    and v_conf_coadmin_b ->> 'event_name' is null
    and v_conf_coadmin_b ->> 'committee_id' is null
    and v_conf_coadmin_b ->> 'committee_name' is null
    and v_conf_coadmin_b ->> 'actor_name' is null
    and v_conf_coadmin_b ->> 'change_summary' is null
    and v_admin_count = v_coadmin_b_count;
  v_results := pg_catalog.array_append(v_results, case when v_ok then pg_catalog.format('PASS: 2 confidential masking is exact and Admin/Co-Admin B cardinality matches at %s', v_admin_count) else 'FAIL: 2 subcases: Admin real row; owning Co-Admin real row; other Co-Admin exact masked nullability; equal cardinality' end);

  select public.task_content_access_for_user(v_draft_task, v_admin),
         public.task_content_access_for_user(v_draft_task, v_coadmin_a),
         public.task_content_access_for_user(v_draft_task, v_coadmin_b)
  into v_access_admin, v_access_coadmin_a, v_access_coadmin_b;

  execute 'set local role authenticated';
  perform pg_catalog.set_config('request.jwt.claim.sub', v_admin::text, true);
  select pg_catalog.to_jsonb(row_value) into v_draft_admin
  from public.list_activity_log(p_sort => 'oldest', p_cursor_created_at => v_base + interval '5 seconds' - interval '1 microsecond', p_cursor_id => v_cursor_id, p_page_size => 20) row_value
  where row_value.activity_id = v_draft_id;
  execute 'reset role';
  execute 'set local role authenticated';
  perform pg_catalog.set_config('request.jwt.claim.sub', v_coadmin_a::text, true);
  select pg_catalog.to_jsonb(row_value) into v_draft_coadmin_a
  from public.list_activity_log(p_sort => 'oldest', p_cursor_created_at => v_base + interval '5 seconds' - interval '1 microsecond', p_cursor_id => v_cursor_id, p_page_size => 20) row_value
  where row_value.activity_id = v_draft_id;
  execute 'reset role';
  execute 'set local role authenticated';
  perform pg_catalog.set_config('request.jwt.claim.sub', v_coadmin_b::text, true);
  select pg_catalog.to_jsonb(row_value) into v_draft_coadmin_b
  from public.list_activity_log(p_sort => 'oldest', p_cursor_created_at => v_base + interval '5 seconds' - interval '1 microsecond', p_cursor_id => v_cursor_id, p_page_size => 20) row_value
  where row_value.activity_id = v_draft_id;
  execute 'reset role';

  v_ok := v_draft_admin is not null and v_draft_coadmin_a is not null and v_draft_coadmin_b is not null
    and ((v_draft_admin ->> 'is_masked')::boolean = (v_access_admin <> 'real'))
    and ((v_draft_coadmin_a ->> 'is_masked')::boolean = (v_access_coadmin_a <> 'real'))
    and ((v_draft_coadmin_b ->> 'is_masked')::boolean = (v_access_coadmin_b <> 'real'))
    and v_access_admin = 'real'
    and v_access_coadmin_a = 'real'
    and v_access_coadmin_b <> 'real'
    and v_draft_admin ->> 'task_title' = 'Step 12 T3 Draft Task ' || v_token
    and v_draft_coadmin_a ->> 'task_title' = 'Step 12 T3 Draft Task ' || v_token
    and v_draft_coadmin_b ->> 'task_title' = 'Confidential Task';
  v_results := pg_catalog.array_append(v_results, case when v_ok then 'PASS: 3 Draft rows exactly follow task_content_access_for_user and other-committee Co-Admin is masked' else 'FAIL: 3 subcases: Admin/helper parity; owning Co-Admin/helper parity; other Co-Admin/helper parity and masking' end);

  execute 'set local role authenticated';
  perform pg_catalog.set_config('request.jwt.claim.sub', v_admin::text, true);
  select pg_catalog.to_jsonb(row_value) into v_deleted_active from public.list_activity_log(p_sort => 'oldest', p_cursor_created_at => v_base + interval '6 seconds' - interval '1 microsecond', p_cursor_id => v_cursor_id, p_page_size => 20) row_value where row_value.activity_id = v_deleted_active_id;
  select pg_catalog.to_jsonb(row_value) into v_deleted_archived from public.list_activity_log(p_sort => 'oldest', p_cursor_created_at => v_base + interval '7 seconds' - interval '1 microsecond', p_cursor_id => v_cursor_id, p_page_size => 20) row_value where row_value.activity_id = v_deleted_archived_id;
  select pg_catalog.to_jsonb(row_value) into v_deleted_draft from public.list_activity_log(p_sort => 'oldest', p_cursor_created_at => v_base + interval '8 seconds' - interval '1 microsecond', p_cursor_id => v_cursor_id, p_page_size => 20) row_value where row_value.activity_id = v_deleted_draft_id;
  select pg_catalog.to_jsonb(row_value) into v_deleted_missing from public.list_activity_log(p_sort => 'oldest', p_cursor_created_at => v_base + interval '9 seconds' - interval '1 microsecond', p_cursor_id => v_cursor_id, p_page_size => 20) row_value where row_value.activity_id = v_deleted_missing_id;
  select pg_catalog.to_jsonb(row_value) into v_deleted_confidential from public.list_activity_log(p_sort => 'oldest', p_cursor_created_at => v_base + interval '10 seconds' - interval '1 microsecond', p_cursor_id => v_cursor_id, p_page_size => 20) row_value where row_value.activity_id = v_deleted_confidential_id;
  select pg_catalog.to_jsonb(row_value) into v_later_deleted_insert from public.list_activity_log(p_sort => 'oldest', p_cursor_created_at => v_base + interval '11 seconds' - interval '1 microsecond', p_cursor_id => v_cursor_id, p_page_size => 20) row_value where row_value.activity_id = v_later_deleted_insert_id;
  select pg_catalog.to_jsonb(row_value) into v_later_deleted_update from public.list_activity_log(p_sort => 'oldest', p_cursor_created_at => v_base + interval '12 seconds' - interval '1 microsecond', p_cursor_id => v_cursor_id, p_page_size => 20) row_value where row_value.activity_id = v_later_deleted_update_id;
  execute 'reset role';

  v_ok := v_deleted_active is not null and v_deleted_archived is not null
    and (v_deleted_active ->> 'is_masked')::boolean is false
    and (v_deleted_archived ->> 'is_masked')::boolean is false
    and v_deleted_active ->> 'task_title' = 'Step 12 T3 Deleted Active ' || v_token
    and v_deleted_archived ->> 'task_title' = 'Step 12 T3 Deleted Archived ' || v_token
    and v_deleted_active ->> 'event_name' = 'Step 12 T3 Active Event ' || v_token
    and v_deleted_archived ->> 'event_name' = 'Step 12 T3 Archived Event ' || v_token
    and (v_deleted_draft ->> 'is_masked')::boolean is true and v_deleted_draft ->> 'task_title' = 'Confidential Task'
    and (v_deleted_missing ->> 'is_masked')::boolean is true and v_deleted_missing ->> 'task_title' = 'Confidential Task'
    and (v_deleted_confidential ->> 'is_masked')::boolean is true and v_deleted_confidential ->> 'task_title' = 'Confidential Task'
    and (v_later_deleted_insert ->> 'is_masked')::boolean is true and v_later_deleted_insert ->> 'task_title' = 'Confidential Task'
    and (v_later_deleted_update ->> 'is_masked')::boolean is true and v_later_deleted_update ->> 'task_title' = 'Confidential Task';
  v_results := pg_catalog.array_append(v_results, case when v_ok then 'PASS: 4 deleted-row lifecycle and fail-closed rules are exact' else 'FAIL: 4 subcases: Active delete; Archived delete; Draft delete; missing-parent delete; confidential delete; later-deleted INSERT; later-deleted UPDATE' end);

  execute 'set local role authenticated';
  perform pg_catalog.set_config('request.jwt.claim.sub', v_admin::text, true);
  select pg_catalog.to_jsonb(row_value) into v_former_actor_row from public.list_activity_log(p_sort => 'oldest', p_cursor_created_at => v_base + interval '13 seconds' - interval '1 microsecond', p_cursor_id => v_cursor_id, p_page_size => 20) row_value where row_value.activity_id = v_former_actor_id;
  select pg_catalog.to_jsonb(row_value) into v_null_actor_row from public.list_activity_log(p_sort => 'oldest', p_cursor_created_at => v_base + interval '14 seconds' - interval '1 microsecond', p_cursor_id => v_cursor_id, p_page_size => 20) row_value where row_value.activity_id = v_null_actor_id;
  execute 'reset role';
  v_ok := v_real_insert ->> 'actor_name' = 'Step 12 T3 Ordinary Actor ' || v_token
    and v_former_actor_row ->> 'actor_name' = 'Former member'
    and v_null_actor_row ->> 'actor_name' = 'Unavailable actor'
    and v_conf_coadmin_b ->> 'actor_name' is null;
  v_results := pg_catalog.array_append(v_results, case when v_ok then 'PASS: 5 actor labels cover ordinary, anonymized, unavailable, and masked rows' else 'FAIL: 5 subcases: ordinary profile; anonymized profile; null/missing profile; masked actor suppression' end);

  v_legacy_ids := array[v_legacy_with_updated_id, v_legacy_without_updated_id, v_legacy_older_id];
  v_legacy_times := array[v_base + interval '15 seconds', v_base + interval '16 seconds', v_base + interval '17 seconds'];
  v_legacy_titles := array['Step 12 T3 Legacy With Updated ' || v_token, 'Step 12 T3 Legacy Without Updated ' || v_token, 'Step 12 T3 Legacy Older Columns ' || v_token];
  v_malformed_ids := array[v_malformed_null_id, v_malformed_string_id, v_malformed_array_id, v_malformed_update_no_old_id, v_malformed_update_no_new_id, v_malformed_title_number_id, v_malformed_confidential_string_id, v_malformed_task_uuid_id, v_malformed_event_uuid_id, v_malformed_committee_uuid_id, v_malformed_empty_title_id, v_malformed_long_title_id];
  v_malformed_times := array[v_base + interval '18 seconds', v_base + interval '19 seconds', v_base + interval '20 seconds', v_base + interval '21 seconds', v_base + interval '22 seconds', v_base + interval '23 seconds', v_base + interval '24 seconds', v_base + interval '25 seconds', v_base + interval '26 seconds', v_base + interval '27 seconds', v_base + interval '28 seconds', v_base + interval '29 seconds'];

  execute 'set local role authenticated';
  perform pg_catalog.set_config('request.jwt.claim.sub', v_admin::text, true);
  for v_index in 1..pg_catalog.array_length(v_legacy_ids, 1) loop
    begin
      select pg_catalog.to_jsonb(row_value) into v_json
      from public.list_activity_log(p_sort => 'oldest', p_cursor_created_at => v_legacy_times[v_index] - interval '1 microsecond', p_cursor_id => v_cursor_id, p_page_size => 20) row_value
      where row_value.activity_id = v_legacy_ids[v_index];
    exception when others then
      v_json := null;
    end;
    v_legacy_ok := v_legacy_ok and v_json is not null
      and (v_json ->> 'is_masked')::boolean is false
      and v_json ->> 'task_title' = v_legacy_titles[v_index];
  end loop;
  for v_index in 1..pg_catalog.array_length(v_malformed_ids, 1) loop
    begin
      select pg_catalog.to_jsonb(row_value) into v_json
      from public.list_activity_log(p_sort => 'oldest', p_cursor_created_at => v_malformed_times[v_index] - interval '1 microsecond', p_cursor_id => v_cursor_id, p_page_size => 20) row_value
      where row_value.activity_id = v_malformed_ids[v_index];
    exception when others then
      v_json := null;
    end;
    v_malformed_ok := v_malformed_ok and v_json is not null
      and (v_json ->> 'is_masked')::boolean is true
      and v_json ->> 'task_title' = 'Confidential Task'
      and v_json ->> 'task_id' is null
      and v_json ->> 'event_name' is null
      and v_json ->> 'committee_id' is null
      and v_json ->> 'committee_name' is null
      and v_json ->> 'actor_name' is null
      and v_json ->> 'change_summary' is null;
  end loop;
  execute 'reset role';
  v_results := pg_catalog.array_append(v_results, case when v_legacy_ok and v_malformed_ok then 'PASS: 6 legacy snapshots stay compatible and every malformed shape fails closed without errors' else 'FAIL: 6 subcases: with updated_at; without updated_at; older columns; null/string/array changes; UPDATE missing old/new; typed fields; invalid UUIDs; empty/long title' end);

  execute 'set local role authenticated';
  perform pg_catalog.set_config('request.jwt.claim.sub', v_coadmin_b::text, true);
  select pg_catalog.to_jsonb(row_value) into v_reclassified_row
  from public.list_activity_log(p_sort => 'oldest', p_cursor_created_at => v_base + interval '30 seconds' - interval '1 microsecond', p_cursor_id => v_cursor_id, p_page_size => 20) row_value
  where row_value.activity_id = v_reclassified_history_id;
  execute 'reset role';
  v_ok := v_reclassified_row is not null
    and (v_reclassified_row ->> 'is_masked')::boolean is false
    and v_reclassified_row ->> 'task_title' = 'Step 12 T3 Old Confidential Title ' || v_token;
  v_results := pg_catalog.array_append(v_results, case when v_ok then 'PASS: 7 current real access reveals the older title from a formerly confidential snapshot by design' else 'FAIL: 7 subcases: current access is real; historical confidential snapshot title is returned' end);

  select pg_catalog.array_agg(object_key order by object_key)
  into v_keys
  from pg_catalog.jsonb_object_keys(v_real_insert) as object_keys(object_key);
  v_ok := not (v_real_insert ? 'changes')
    and pg_catalog.cardinality(v_keys) = 14
    and v_keys = array[
      'action', 'activity_created_at', 'activity_id', 'actor_name',
      'change_summary', 'committee_id', 'committee_name', 'event_name',
      'has_more', 'is_masked', 'next_cursor_created_at', 'next_cursor_id',
      'task_id', 'task_title'
    ]::text[];
  v_results := pg_catalog.array_append(v_results, case when v_ok then 'PASS: 8 reader result has exactly 14 approved columns and no changes column' else pg_catalog.format('FAIL: 8 subcases: changes absent; exact 14-column key set; actual keys: %s', v_keys) end);

  raise exception E'TEST RESULTS (expected 8 lines)\n%',
    pg_catalog.array_to_string(v_results, E'\n');
end
$test$;
```

## TEST 4: filters, search, sort and input validation

Expected result-line count: **10**.

Paste the whole script into the Dev SQL editor and choose **Run without RLS**. It owns uniquely tokenized Auth and application fixtures, impersonates authenticated callers explicitly, and rolls everything back through the final intentional `TEST RESULTS` exception.

```sql
begin;

do $test$
declare
  v_token text := pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
  v_results text[] := array[]::text[];
  v_admin uuid := pg_catalog.gen_random_uuid();
  v_coadmin_b uuid := pg_catalog.gen_random_uuid();
  v_actor uuid := pg_catalog.gen_random_uuid();
  v_hidden_actor uuid := pg_catalog.gen_random_uuid();
  v_committee_a uuid := pg_catalog.gen_random_uuid();
  v_committee_b uuid := pg_catalog.gen_random_uuid();
  v_event_a uuid := pg_catalog.gen_random_uuid();
  v_event_b uuid := pg_catalog.gen_random_uuid();
  v_public_task uuid := pg_catalog.gen_random_uuid();
  v_hidden_task uuid := pg_catalog.gen_random_uuid();
  v_insert_id uuid := pg_catalog.gen_random_uuid();
  v_update_id uuid := pg_catalog.gen_random_uuid();
  v_delete_id uuid := pg_catalog.gen_random_uuid();
  v_hidden_insert_id uuid := pg_catalog.gen_random_uuid();
  v_hidden_delete_id uuid := pg_catalog.gen_random_uuid();
  v_literal_id uuid := pg_catalog.gen_random_uuid();
  v_null_name_id uuid := pg_catalog.gen_random_uuid();
  v_masked_admin_id uuid := pg_catalog.gen_random_uuid();
  v_tie_low uuid := '11111111-1111-4111-8111-111111111111'::uuid;
  v_tie_high uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid;
  v_day_end timestamptz := '2035-06-14 15:59:59.999999+00'::timestamptz;
  v_day_next timestamptz := '2035-06-14 16:00:00+00'::timestamptz;
  v_snap jsonb;
  v_old jsonb;
  v_new jsonb;
  v_hidden_snap jsonb;
  v_ids uuid[];
  v_oldest uuid[];
  v_newest uuid[];
  v_ok boolean;
  v_count integer;
  v_baseline integer;
  v_state text;
  v_message text;
  v_sql text;
  v_invalid_ok boolean := true;
  v_invalid_seen integer := 0;
  v_tz text;
begin
  if current_user <> 'postgres' then
    raise exception 'TEST 4 must run without RLS as postgres; current_user is %.', current_user;
  end if;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, confirmation_token, recovery_token,
    email_change_token_new, email_change_token_current, phone_change_token,
    reauthentication_token, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  )
  select id, '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated', 'authenticated',
    pg_catalog.format('step12-t4-%s-%s@example.test', v_token, n), '',
    pg_catalog.clock_timestamp(), v_token || '-c-' || n, v_token || '-r-' || n,
    v_token || '-en-' || n, v_token || '-ec-' || n, v_token || '-p-' || n,
    v_token || '-a-' || n, '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
  from pg_catalog.unnest(array[v_admin, v_coadmin_b, v_actor, v_hidden_actor]::uuid[])
    with ordinality as fixture(id, n);

  insert into public.committees (id, name) values
    (v_committee_a, 'T4 Hidden Committee ' || v_token),
    (v_committee_b, 'T4 Public Committee ' || v_token);
  perform pg_catalog.set_config('ceit_connect.officer_writer', 'invite_new_officer', true);
  insert into public.users (id, email, full_name, role, committee_id, is_active) values
    (v_admin, pg_catalog.format('step12-t4-%s-1@example.test', v_token), 'T4 Admin ' || v_token, 'Admin', null, true),
    (v_coadmin_b, pg_catalog.format('step12-t4-%s-2@example.test', v_token), 'T4 CoAdmin B ' || v_token, 'Co-Admin', v_committee_b, true);
  perform pg_catalog.set_config('ceit_connect.officer_writer', '', true);
  insert into public.users (id, email, full_name, role, committee_id, is_active) values
    (v_actor, pg_catalog.format('step12-t4-%s-3@example.test', v_token), 'T4 Search Actor ' || v_token, 'Member', v_committee_b, true),
    (v_hidden_actor, pg_catalog.format('step12-t4-%s-4@example.test', v_token), 'T4 Hidden Actor ' || v_token, 'Member', v_committee_a, true);

  insert into public.events (id, name, start_date, end_date, status, created_by) values
    (v_event_a, 'T4 Hidden Event ' || v_token, '2035-06-14', '2035-06-15', 'Active', v_admin),
    (v_event_b, 'T4 Public Event ' || v_token, '2035-06-14', '2035-06-15', 'Active', v_admin);
  perform pg_catalog.set_config('request.jwt.claim.sub', v_admin::text, true);
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  perform pg_catalog.set_config('ceit_connect.task_assignee_writer', 'create_event_with_tasks', true);
  insert into public.tasks (
    id, event_id, committee_id, title, description, phase, status, priority,
    task_type, primary_assignees, assist_assignees, is_confidential,
    request_backup, allowed_viewers, created_by, sort_order
  ) values
    (v_public_task, v_event_b, v_committee_b, 'T4 Public Title ' || v_token, 'fixture', 'Execution', 'To Do', 'Medium', 'Deliverable', '{}'::uuid[], '{}'::uuid[], false, false, '{}'::uuid[], v_admin, 1024),
    (v_hidden_task, v_event_a, v_committee_a, 'T4 Hidden Title ' || v_token, 'fixture', 'Execution', 'To Do', 'Medium', 'Deliverable', '{}'::uuid[], '{}'::uuid[], true, false, '{}'::uuid[], v_admin, 1024);
  perform pg_catalog.set_config('ceit_connect.task_assignee_writer', '', true);
  set constraints all immediate;

  v_snap := pg_catalog.jsonb_build_object('id', v_public_task::text, 'event_id', v_event_b::text, 'committee_id', v_committee_b::text, 'title', 'T4 Public Title ' || v_token, 'is_confidential', false, 'status', 'To Do');
  v_old := v_snap;
  v_new := v_snap || pg_catalog.jsonb_build_object('status', 'In Progress');
  v_hidden_snap := pg_catalog.jsonb_build_object('id', v_hidden_task::text, 'event_id', v_event_a::text, 'committee_id', v_committee_a::text, 'title', 'T4 Hidden Title ' || v_token, 'is_confidential', true);
  insert into public.activity_log (id, task_id, user_id, action, changes, created_at) values
    (v_insert_id, v_public_task, v_actor, 'INSERT', v_snap, v_day_end),
    (v_update_id, v_public_task, v_actor, 'UPDATE', pg_catalog.jsonb_build_object('old', v_old, 'new', v_new), v_day_next),
    (v_delete_id, v_public_task, v_actor, 'DELETE', v_snap, v_day_next + interval '1 microsecond'),
    (v_hidden_insert_id, v_hidden_task, v_hidden_actor, 'INSERT', v_hidden_snap, v_day_next + interval '2 microseconds'),
    (v_hidden_delete_id, v_hidden_task, v_hidden_actor, 'DELETE', v_hidden_snap, v_day_next + interval '3 microseconds'),
    (v_literal_id, v_public_task, v_actor, 'INSERT', v_snap || pg_catalog.jsonb_build_object('title', 'T4 literal % _ \\ ' || v_token), v_day_next + interval '4 microseconds'),
    (v_null_name_id, null, v_actor, 'DELETE', pg_catalog.jsonb_build_object('id', pg_catalog.gen_random_uuid()::text, 'event_id', v_event_b::text, 'committee_id', pg_catalog.gen_random_uuid()::text, 'title', 'T4 Null Committee ' || v_token, 'is_confidential', false), v_day_next + interval '5 microseconds'),
    (v_masked_admin_id, v_public_task, v_actor, 'INSERT', null, v_day_next + interval '6 microseconds'),
    (v_tie_low, v_public_task, v_actor, 'INSERT', v_snap, v_day_next + interval '7 microseconds'),
    (v_tie_high, v_public_task, v_actor, 'INSERT', v_snap, v_day_next + interval '7 microseconds');

  execute 'set local role authenticated';
  perform pg_catalog.set_config('request.jwt.claim.sub', v_coadmin_b::text, true);

  select pg_catalog.bool_and(action = 'DELETE') and pg_catalog.bool_or(activity_id = v_hidden_delete_id)
  into v_ok
  from public.list_activity_log(p_action => 'DELETE', p_sort => 'oldest', p_date_from => '2035-06-14', p_date_to => '2035-06-15')
  where activity_id is not null;
  v_results := pg_catalog.array_append(v_results, case when coalesce(v_ok, false) then 'PASS: 1 action filter applies to real and masked rows' else 'FAIL: 1 subcases: only requested action; masked DELETE retained' end);

  execute 'reset role';
  execute 'set local role authenticated';
  perform pg_catalog.set_config('request.jwt.claim.sub', v_admin::text, true);
  select pg_catalog.bool_and(not is_masked and committee_id = v_committee_b)
         and pg_catalog.bool_or(activity_id = v_insert_id)
         and not pg_catalog.bool_or(activity_id = v_masked_admin_id)
  into v_ok
  from public.list_activity_log(p_committee_id => v_committee_b, p_date_from => '2035-06-14', p_date_to => '2035-06-15')
  where activity_id is not null;
  v_results := pg_catalog.array_append(v_results, case when coalesce(v_ok, false) then 'PASS: 2 committee filter returns only matching real rows and excludes masked rows for Admin' else 'FAIL: 2 subcases: committee identity; real-only; Admin masked-row exclusion' end);

  select pg_catalog.count(*) into v_count from (
    select 'actor' from public.list_activity_log(p_search => '  t4 search actor ' || pg_catalog.upper(v_token) || '  ', p_date_from => '2035-06-14', p_date_to => '2035-06-15') where activity_id = v_insert_id
    union all select 'action' from public.list_activity_log(p_search => 'cReAtEd', p_date_from => '2035-06-14', p_date_to => '2035-06-15') where activity_id = v_insert_id
    union all select 'title' from public.list_activity_log(p_search => 'public title ' || pg_catalog.upper(v_token), p_date_from => '2035-06-14', p_date_to => '2035-06-15') where activity_id = v_insert_id
    union all select 'event' from public.list_activity_log(p_search => 'public event ' || pg_catalog.upper(v_token), p_date_from => '2035-06-14', p_date_to => '2035-06-15') where activity_id = v_insert_id
    union all select 'committee' from public.list_activity_log(p_search => 'public committee ' || pg_catalog.upper(v_token), p_date_from => '2035-06-14', p_date_to => '2035-06-15') where activity_id = v_insert_id
  ) hits;
  v_results := pg_catalog.array_append(v_results, case when v_count = 5 then 'PASS: 3 trimmed case-insensitive search matches actor, action, title, event, and committee labels' else pg_catalog.format('FAIL: 3 subcases: actor/action/title/event/committee search; hits=%s', v_count) end);

  select pg_catalog.count(*) into v_count from (
    select 1 from public.list_activity_log(p_search => '%', p_date_from => '2035-06-15', p_date_to => '2035-06-15') where activity_id = v_literal_id
    union all select 1 from public.list_activity_log(p_search => '_', p_date_from => '2035-06-15', p_date_to => '2035-06-15') where activity_id = v_literal_id
    union all select 1 from public.list_activity_log(p_search => E'\\', p_date_from => '2035-06-15', p_date_to => '2035-06-15') where activity_id = v_literal_id
  ) literal_hits;
  v_results := pg_catalog.array_append(v_results, case when v_count = 3 then 'PASS: 4 search treats percent, underscore, and backslash literally' else pg_catalog.format('FAIL: 4 subcases: literal %%/_/backslash; hits=%s', v_count) end);

  execute 'reset role';
  execute 'set local role authenticated';
  perform pg_catalog.set_config('request.jwt.claim.sub', v_coadmin_b::text, true);
  select pg_catalog.count(*) into v_count from (
    select 1 from public.list_activity_log(p_search => 'T4 Hidden Title ' || v_token, p_date_from => '2035-06-15', p_date_to => '2035-06-15') where activity_id is not null
    union all select 1 from public.list_activity_log(p_search => 'T4 Hidden Event ' || v_token, p_date_from => '2035-06-15', p_date_to => '2035-06-15') where activity_id is not null
    union all select 1 from public.list_activity_log(p_search => 'T4 Hidden Committee ' || v_token, p_date_from => '2035-06-15', p_date_to => '2035-06-15') where activity_id is not null
    union all select 1 from public.list_activity_log(p_search => 'T4 Hidden Actor ' || v_token, p_date_from => '2035-06-15', p_date_to => '2035-06-15') where activity_id is not null
  ) oracle_hits;
  v_results := pg_catalog.array_append(v_results, case when v_count = 0 then 'PASS: 5 search is not an oracle and excludes every masked row' else pg_catalog.format('FAIL: 5 subcases: hidden title/event/committee/actor; leaked rows=%s', v_count) end);

  select pg_catalog.count(*) into v_count
  from public.list_activity_log(p_search => 'definitely absent ' || v_token, p_date_from => '2035-06-15', p_date_to => '2035-06-15')
  where activity_id in (v_null_name_id, v_masked_admin_id);
  v_results := pg_catalog.array_append(v_results, case when v_count = 0 then 'PASS: 6 NULL event or committee names do not admit non-matching rows' else 'FAIL: 6 subcases: NULL event/committee coalescing; non-match exclusion' end);

  v_ok := true;
  foreach v_tz in array array['UTC', 'America/Los_Angeles'] loop
    perform pg_catalog.set_config('TimeZone', v_tz, true);
    select pg_catalog.count(*) into v_count from public.list_activity_log(p_date_from => '2035-06-14', p_date_to => '2035-06-14') where activity_id = v_insert_id;
    v_ok := v_ok and v_count = 1;
    select pg_catalog.count(*) into v_count from public.list_activity_log(p_date_from => '2035-06-14', p_date_to => '2035-06-14') where activity_id = v_update_id;
    v_ok := v_ok and v_count = 0;
    select pg_catalog.count(*) into v_count from public.list_activity_log(p_date_from => '2035-06-15') where activity_id = v_update_id;
    v_ok := v_ok and v_count = 1;
    select pg_catalog.count(*) into v_count from public.list_activity_log(p_date_to => '2035-06-14') where activity_id = v_insert_id;
    v_ok := v_ok and v_count = 1;
  end loop;
  v_results := pg_catalog.array_append(v_results, case when v_ok then 'PASS: 7 Manila inclusive date boundaries and one-sided ranges are session-time-zone independent' else 'FAIL: 7 subcases: day-end; next-day midnight; from-only; to-only; UTC/Los_Angeles parity' end);

  perform pg_catalog.set_config('TimeZone', 'UTC', true);
  select pg_catalog.array_agg(activity_id order by activity_id asc) into v_oldest from public.list_activity_log(p_sort => 'oldest', p_date_from => '2035-06-15', p_date_to => '2035-06-15') where activity_id in (v_tie_low, v_tie_high);
  select pg_catalog.array_agg(activity_id order by activity_id desc) into v_newest from public.list_activity_log(p_sort => 'newest', p_date_from => '2035-06-15', p_date_to => '2035-06-15') where activity_id in (v_tie_low, v_tie_high);
  v_ok := v_oldest = array[v_tie_low, v_tie_high] and v_newest = array[v_tie_high, v_tie_low];
  v_results := pg_catalog.array_append(v_results, case when v_ok then 'PASS: 8 newest and oldest are exact stable reverses by created_at and id' else pg_catalog.format('FAIL: 8 subcases: equal-time id tie-break; exact reversal; oldest=%s newest=%s', v_oldest, v_newest) end);

  select pg_catalog.count(*) into v_count
  from public.list_activity_log(p_action => 'INSERT', p_committee_id => v_committee_b, p_date_from => '2035-06-14', p_date_to => '2035-06-15', p_search => 'T4 Public Title ' || v_token)
  where activity_id in (v_insert_id, v_update_id, v_delete_id, v_hidden_insert_id);
  v_results := pg_catalog.array_append(v_results, case when v_count = 1 then 'PASS: 9 action, committee, date, and search filters compose correctly' else pg_catalog.format('FAIL: 9 subcases: combined action/committee/date/search; matches=%s', v_count) end);

  select pg_catalog.count(*) into v_baseline from public.list_activity_log(p_search => null, p_date_from => '2035-06-14', p_date_to => '2035-06-15');
  select pg_catalog.count(*) into v_count from public.list_activity_log(p_search => E' \t\n ', p_date_from => '2035-06-14', p_date_to => '2035-06-15');
  v_invalid_ok := v_baseline = v_count;
  foreach v_sql in array array[
    'select count(*) from public.list_activity_log(p_sort => ''sideways'')',
    'select count(*) from public.list_activity_log(p_action => ''UPSERT'')',
    'select count(*) from public.list_activity_log(p_page_size => 0)',
    'select count(*) from public.list_activity_log(p_page_size => 21)',
    'select count(*) from public.list_activity_log(p_page_size => null)',
    'select count(*) from public.list_activity_log(p_cursor_created_at => pg_catalog.clock_timestamp())',
    'select count(*) from public.list_activity_log(p_cursor_id => pg_catalog.gen_random_uuid())',
    'select count(*) from public.list_activity_log(p_date_from => ''2035-06-16'', p_date_to => ''2035-06-15'')',
    'select count(*) from public.list_activity_log(p_search => pg_catalog.repeat(''x'', 101))',
    'select count(*) from public.list_activity_log(p_search => pg_catalog.chr(1))'
  ] loop
    v_state := null; v_message := null;
    begin
      execute v_sql into v_count;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    end;
    v_invalid_seen := v_invalid_seen + 1;
    v_invalid_ok := v_invalid_ok and v_state = 'CAL02'
      and v_message = 'The activity log request is invalid.'
      and v_message not like '%sideways%' and v_message not like '%UPSERT%';
  end loop;
  execute 'reset role';
  v_results := pg_catalog.array_append(v_results, case when v_invalid_ok and v_invalid_seen = 10 then 'PASS: 10 invalid inputs share fixed CAL02 without echo and whitespace-only search is empty search' else pg_catalog.format('FAIL: 10 subcases: sort/action/page sizes/cursor pair/date order/search length/control/fixed no-echo message/whitespace; cases=%s', v_invalid_seen) end);

  raise exception E'TEST RESULTS (expected 10 lines)\n%', pg_catalog.array_to_string(v_results, E'\n');
end
$test$;
```

## TEST 5: paging, scan cap and sentinel

Expected result-line count: **9**.

Paste the whole script into the Dev SQL editor and choose **Run without RLS**. It creates its own uniquely tokenized Auth and application fixtures, explicitly impersonates an authenticated caller, and intentionally raises `TEST RESULTS` so the transaction—including the large crafted log—is rolled back.

```sql
begin;

do $test$
declare
  v_token text := pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
  v_results text[] := array[]::text[];
  v_admin uuid := pg_catalog.gen_random_uuid();
  v_coadmin_b uuid := pg_catalog.gen_random_uuid();
  v_committee_a uuid := pg_catalog.gen_random_uuid();
  v_committee_b uuid := pg_catalog.gen_random_uuid();
  v_event_a uuid := pg_catalog.gen_random_uuid();
  v_event_b uuid := pg_catalog.gen_random_uuid();
  v_public_task uuid := pg_catalog.gen_random_uuid();
  v_hidden_task uuid := pg_catalog.gen_random_uuid();
  v_base timestamptz := '2040-01-15 00:00:00+00'::timestamptz;
  v_cap_base timestamptz := '2040-02-15 00:00:00+00'::timestamptz;
  v_snap jsonb;
  v_hidden_snap jsonb;
  v_ids uuid[];
  v_expected uuid[];
  v_seen uuid[] := '{}'::uuid[];
  v_page uuid[];
  v_first_page uuid[];
  v_rest uuid[] := '{}'::uuid[];
  v_cursor_time timestamptz;
  v_cursor_id uuid;
  v_cursor_text text;
  v_next_time timestamptz;
  v_next_id uuid;
  v_has_more boolean;
  v_ok boolean;
  v_count integer;
  v_page_no integer := 0;
  v_cap_first uuid := pg_catalog.gen_random_uuid();
  v_cap_target uuid := pg_catalog.gen_random_uuid();
  v_concurrent uuid := pg_catalog.gen_random_uuid();
  v_sentinel jsonb;
  v_masked jsonb;
  v_shape jsonb;
  v_keys text[];
begin
  if current_user <> 'postgres' then
    raise exception 'TEST 5 must run without RLS as postgres; current_user is %.', current_user;
  end if;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, confirmation_token, recovery_token,
    email_change_token_new, email_change_token_current, phone_change_token,
    reauthentication_token, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  )
  select id, '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated', 'authenticated',
    pg_catalog.format('step12-t5-%s-%s@example.test', v_token, n), '',
    pg_catalog.clock_timestamp(), v_token || '-c-' || n, v_token || '-r-' || n,
    v_token || '-en-' || n, v_token || '-ec-' || n, v_token || '-p-' || n,
    v_token || '-a-' || n, '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
  from pg_catalog.unnest(array[v_admin, v_coadmin_b]::uuid[])
    with ordinality as fixture(id, n);

  insert into public.committees (id, name) values
    (v_committee_a, 'T5 Hidden Committee ' || v_token),
    (v_committee_b, 'T5 Public Committee ' || v_token);
  perform pg_catalog.set_config('ceit_connect.officer_writer', 'invite_new_officer', true);
  insert into public.users (id, email, full_name, role, committee_id, is_active) values
    (v_admin, pg_catalog.format('step12-t5-%s-1@example.test', v_token), 'T5 Admin ' || v_token, 'Admin', null, true),
    (v_coadmin_b, pg_catalog.format('step12-t5-%s-2@example.test', v_token), 'T5 CoAdmin B ' || v_token, 'Co-Admin', v_committee_b, true);
  perform pg_catalog.set_config('ceit_connect.officer_writer', '', true);

  insert into public.events (id, name, start_date, end_date, status, created_by) values
    (v_event_a, 'T5 Hidden Event ' || v_token, '2040-01-01', '2040-02-28', 'Active', v_admin),
    (v_event_b, 'T5 Public Event ' || v_token, '2040-01-01', '2040-02-28', 'Active', v_admin);
  perform pg_catalog.set_config('request.jwt.claim.sub', v_admin::text, true);
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  perform pg_catalog.set_config('ceit_connect.task_assignee_writer', 'create_event_with_tasks', true);
  insert into public.tasks (
    id, event_id, committee_id, title, description, phase, status, priority,
    task_type, primary_assignees, assist_assignees, is_confidential,
    request_backup, allowed_viewers, created_by, sort_order
  ) values
    (v_public_task, v_event_b, v_committee_b, 'T5 Public ' || v_token, 'fixture', 'Execution', 'To Do', 'Medium', 'Deliverable', '{}'::uuid[], '{}'::uuid[], false, false, '{}'::uuid[], v_admin, 1024),
    (v_hidden_task, v_event_a, v_committee_a, 'T5 Hidden ' || v_token, 'fixture', 'Execution', 'To Do', 'Medium', 'Deliverable', '{}'::uuid[], '{}'::uuid[], true, false, '{}'::uuid[], v_admin, 1024);
  perform pg_catalog.set_config('ceit_connect.task_assignee_writer', '', true);
  set constraints all immediate;

  v_snap := pg_catalog.jsonb_build_object('id', v_public_task::text, 'event_id', v_event_b::text, 'committee_id', v_committee_b::text, 'title', 'T5 Public ' || v_token, 'is_confidential', false);
  v_hidden_snap := pg_catalog.jsonb_build_object('id', v_hidden_task::text, 'event_id', v_event_a::text, 'committee_id', v_committee_a::text, 'title', 'T5 Hidden ' || v_token, 'is_confidential', true);

  insert into public.activity_log (id, task_id, user_id, action, changes, created_at)
  select (pg_catalog.md5(v_token || '-base-' || n))::uuid,
    v_public_task, v_admin,
    case when n <= 21 then 'INSERT' else 'UPDATE' end,
    case when n <= 21 then v_snap else pg_catalog.jsonb_build_object('old', v_snap, 'new', v_snap) end,
    v_base + pg_catalog.make_interval(secs => n::double precision / 1000000.0)
  from pg_catalog.generate_series(1, 45) as series(n);
  select pg_catalog.array_agg((pg_catalog.md5(v_token || '-base-' || n))::uuid order by n)
  into v_expected from pg_catalog.generate_series(1, 45) as series(n);

  execute 'set local role authenticated';
  perform pg_catalog.set_config('request.jwt.claim.sub', v_coadmin_b::text, true);

  v_cursor_time := null; v_cursor_id := null; v_seen := '{}'::uuid[]; v_page_no := 0;
  loop
    v_page_no := v_page_no + 1;
    select pg_catalog.array_agg(activity_id), pg_catalog.bool_or(has_more),
           pg_catalog.max(next_cursor_created_at),
           (pg_catalog.array_agg(next_cursor_id))[1]
    into v_page, v_has_more, v_next_time, v_next_id
    from public.list_activity_log(p_sort => 'oldest', p_date_from => '2040-01-15', p_date_to => '2040-01-15', p_cursor_created_at => v_cursor_time, p_cursor_id => v_cursor_id, p_page_size => 20)
    where activity_id = any(v_expected);
    v_seen := v_seen || coalesce(v_page, '{}'::uuid[]);
    exit when not coalesce(v_has_more, false);
    v_cursor_time := v_next_time; v_cursor_id := v_next_id;
    exit when v_page_no > 4;
  end loop;
  v_ok := v_page_no = 3 and pg_catalog.cardinality(v_seen) = 45
    and (select pg_catalog.count(distinct x) from pg_catalog.unnest(v_seen) x) = 45
    and not exists (select 1 from pg_catalog.unnest(v_expected) x where not x = any(v_seen));
  v_results := pg_catalog.array_append(v_results, case when v_ok then 'PASS: 1 20-row, 21-row, and 45-row pagination has no duplicates or gaps' else pg_catalog.format('FAIL: 1 subcases: first 20; 21st row; large append; duplicates/gaps; pages=%s seen=%s', v_page_no, pg_catalog.cardinality(v_seen)) end);

  select pg_catalog.count(*), pg_catalog.bool_and(has_more),
         pg_catalog.min(next_cursor_created_at),
         (pg_catalog.array_agg(next_cursor_id))[1]
  into v_count, v_has_more, v_next_time, v_next_id
  from public.list_activity_log(p_sort => 'oldest', p_action => 'INSERT', p_date_from => '2040-01-15', p_date_to => '2040-01-15', p_page_size => 20)
  where activity_id = any(v_expected);
  v_ok := v_count = 20 and v_has_more and v_next_time is not null and v_next_id is not null;
  select pg_catalog.count(*), pg_catalog.bool_or(has_more),
         pg_catalog.max(next_cursor_created_at),
         (pg_catalog.array_agg(next_cursor_id))[1]
  into v_count, v_has_more, v_cursor_time, v_cursor_id
  from public.list_activity_log(p_sort => 'oldest', p_action => 'INSERT', p_date_from => '2040-01-15', p_date_to => '2040-01-15', p_cursor_created_at => v_next_time, p_cursor_id => v_next_id, p_page_size => 20)
  where activity_id = any(v_expected);
  v_ok := v_ok and v_count = 1 and not coalesce(v_has_more, false) and v_cursor_time is null and v_cursor_id is null;
  v_results := pg_catalog.array_append(v_results, case when v_ok then 'PASS: 2 has_more and cursor are present only while another row exists' else 'FAIL: 2 subcases: full first page; one-row final page; terminal cursor nullability' end);

  select next_cursor_created_at::text, next_cursor_id
  into v_cursor_text, v_cursor_id
  from public.list_activity_log(p_sort => 'oldest', p_date_from => '2040-01-15', p_date_to => '2040-01-15', p_page_size => 20)
  where activity_id = any(v_expected) limit 1;
  select pg_catalog.count(*) into v_count
  from public.list_activity_log(p_sort => 'oldest', p_date_from => '2040-01-15', p_date_to => '2040-01-15', p_cursor_created_at => v_cursor_text::timestamptz, p_cursor_id => v_cursor_id, p_page_size => 20)
  where activity_id = v_expected[21];
  v_ok := v_cursor_text is not null and v_cursor_text::timestamptz = v_base + interval '20 microseconds' and v_count = 1;
  v_results := pg_catalog.array_append(v_results, case when v_ok then 'PASS: 3 exact returned timestamp string preserves microseconds for continuation' else pg_catalog.format('FAIL: 3 subcases: exact cursor text; microsecond boundary; next row; cursor=%s', v_cursor_text) end);

  execute 'reset role';
  insert into public.activity_log (id, task_id, user_id, action, changes, created_at)
  values (v_cap_first, v_public_task, v_admin, 'INSERT', v_snap || pg_catalog.jsonb_build_object('title', 'T5 cap needle ' || v_token), v_cap_base);
  insert into public.activity_log (id, task_id, user_id, action, changes, created_at)
  select (pg_catalog.md5(v_token || '-cap-' || n))::uuid, v_hidden_task, v_admin, 'INSERT', v_hidden_snap,
    v_cap_base + pg_catalog.make_interval(secs => n::double precision / 1000000.0)
  from pg_catalog.generate_series(1, 2002) as series(n);
  insert into public.activity_log (id, task_id, user_id, action, changes, created_at)
  values (v_cap_target, v_public_task, v_admin, 'INSERT', v_snap || pg_catalog.jsonb_build_object('title', 'T5 cap needle ' || v_token), v_cap_base + interval '2003 microseconds');

  execute 'set local role authenticated';
  perform pg_catalog.set_config('request.jwt.claim.sub', v_coadmin_b::text, true);
  select pg_catalog.count(*), pg_catalog.bool_and(has_more),
         pg_catalog.min(next_cursor_created_at),
         (pg_catalog.array_agg(next_cursor_id))[1]
  into v_count, v_has_more, v_next_time, v_next_id
  from public.list_activity_log(p_sort => 'oldest', p_search => 'T5 cap needle ' || v_token, p_cursor_created_at => v_cap_base - interval '1 microsecond', p_cursor_id => '00000000-0000-0000-0000-000000000000'::uuid)
  where activity_id is not null;
  v_ok := v_count = 1 and v_has_more and v_next_time is not null and v_next_id is not null;
  select pg_catalog.count(*) into v_count from public.list_activity_log(p_sort => 'oldest', p_search => 'T5 cap needle ' || v_token, p_cursor_created_at => v_next_time, p_cursor_id => v_next_id) where activity_id = v_cap_target;
  v_ok := v_ok and v_count = 1;
  v_results := pg_catalog.array_append(v_results, case when v_ok then 'PASS: 4 2,000-candidate cap returns a partial page and continuation reaches the next match' else 'FAIL: 4 subcases: partial match; has_more/cursor; continuation after last scanned candidate' end);

  select pg_catalog.to_jsonb(row_value) into v_sentinel
  from public.list_activity_log(p_sort => 'oldest', p_search => 'T5 cap needle ' || v_token, p_cursor_created_at => v_cap_base, p_cursor_id => v_cap_first) row_value;
  v_ok := v_sentinel is not null
    and v_sentinel ->> 'activity_id' is null and v_sentinel ->> 'activity_created_at' is null
    and v_sentinel ->> 'action' is null and v_sentinel ->> 'task_id' is null
    and v_sentinel ->> 'task_title' is null and v_sentinel ->> 'event_name' is null
    and v_sentinel ->> 'committee_id' is null and v_sentinel ->> 'committee_name' is null
    and v_sentinel ->> 'actor_name' is null and v_sentinel ->> 'change_summary' is null
    and v_sentinel ->> 'is_masked' is null and (v_sentinel ->> 'has_more')::boolean
    and v_sentinel ->> 'next_cursor_created_at' is not null and v_sentinel ->> 'next_cursor_id' is not null;
  select pg_catalog.count(*) into v_count
  from public.list_activity_log(p_sort => 'oldest', p_search => 'T5 cap needle ' || v_token, p_cursor_created_at => (v_sentinel ->> 'next_cursor_created_at')::timestamptz, p_cursor_id => (v_sentinel ->> 'next_cursor_id')::uuid)
  where activity_id = v_cap_target;
  v_ok := v_ok and v_count = 1;
  v_results := pg_catalog.array_append(v_results, case when v_ok then 'PASS: 5 empty capped scan returns one exact sentinel whose cursor continues' else 'FAIL: 5 subcases: exactly one sentinel; all content null; has_more/cursor; continuation' end);

  select pg_catalog.count(*) into v_count
  from public.list_activity_log(p_date_from => '2099-01-01', p_date_to => '2099-01-01');
  v_results := pg_catalog.array_append(v_results, case when v_count = 0 then 'PASS: 6 normal empty result returns zero rows' else pg_catalog.format('FAIL: 6 subcases: non-capped empty result; no sentinel; rows=%s', v_count) end);

  select pg_catalog.to_jsonb(row_value) into v_masked
  from public.list_activity_log(p_sort => 'oldest', p_cursor_created_at => v_cap_base, p_cursor_id => v_cap_first) row_value
  where row_value.activity_id = (pg_catalog.md5(v_token || '-cap-1'))::uuid;
  v_ok := (v_masked ->> 'is_masked')::boolean and v_masked ->> 'task_title' = 'Confidential Task'
    and v_masked ->> 'activity_id' is not null and v_masked ->> 'activity_created_at' is not null
    and v_masked ->> 'action' = 'INSERT' and v_masked ->> 'task_id' is null
    and v_masked ->> 'event_name' is null and v_masked ->> 'committee_id' is null
    and v_masked ->> 'committee_name' is null and v_masked ->> 'actor_name' is null
    and v_masked ->> 'change_summary' is null;
  v_results := pg_catalog.array_append(v_results, case when v_ok then 'PASS: 7 masked rows expose only identity, timestamp, action, placeholder, masking, and paging fields' else 'FAIL: 7 subcases: allowed masked fields; forbidden task/event/committee/actor/summary fields' end);

  select pg_catalog.array_agg(activity_id), pg_catalog.min(next_cursor_created_at),
         (pg_catalog.array_agg(next_cursor_id))[1]
  into v_first_page, v_cursor_time, v_cursor_id
  from public.list_activity_log(p_sort => 'newest', p_date_from => '2040-01-15', p_date_to => '2040-01-15', p_page_size => 20)
  where activity_id = any(v_expected);
  execute 'reset role';
  insert into public.activity_log (id, task_id, user_id, action, changes, created_at)
  values (v_concurrent, v_public_task, v_admin, 'INSERT', v_snap, v_base + interval '1 second');
  execute 'set local role authenticated';
  perform pg_catalog.set_config('request.jwt.claim.sub', v_coadmin_b::text, true);
  loop
    select pg_catalog.array_agg(activity_id), pg_catalog.bool_or(has_more),
           pg_catalog.min(next_cursor_created_at),
           (pg_catalog.array_agg(next_cursor_id))[1]
    into v_page, v_has_more, v_next_time, v_next_id
    from public.list_activity_log(p_sort => 'newest', p_date_from => '2040-01-15', p_date_to => '2040-01-15', p_cursor_created_at => v_cursor_time, p_cursor_id => v_cursor_id, p_page_size => 20)
    where activity_id = any(v_expected);
    v_rest := v_rest || coalesce(v_page, '{}'::uuid[]);
    exit when not coalesce(v_has_more, false);
    v_cursor_time := v_next_time; v_cursor_id := v_next_id;
  end loop;
  v_seen := coalesce(v_first_page, '{}'::uuid[]) || v_rest;
  v_ok := pg_catalog.cardinality(v_seen) = 45
    and not (v_concurrent = any(v_seen))
    and (select pg_catalog.count(distinct x) from pg_catalog.unnest(v_seen) x) = 45;
  v_results := pg_catalog.array_append(v_results, case when v_ok then 'PASS: 8 insertion between pages neither duplicates nor skips original rows' else 'FAIL: 8 subcases: insertion excluded above cursor; original 45 complete; no duplicates' end);

  select pg_catalog.to_jsonb(row_value) into v_shape
  from public.list_activity_log(p_sort => 'oldest', p_date_from => '2040-01-15', p_date_to => '2040-01-15', p_cursor_created_at => v_base, p_cursor_id => '00000000-0000-0000-0000-000000000000'::uuid) row_value
  where activity_id = v_expected[1];
  select pg_catalog.array_agg(object_key order by object_key) into v_keys
  from pg_catalog.jsonb_object_keys(v_shape) as keys(object_key);
  v_ok := not (v_shape ? 'changes') and pg_catalog.cardinality(v_keys) = 14;
  execute 'reset role';
  v_results := pg_catalog.array_append(v_results, case when v_ok then 'PASS: 9 reader shape has exactly 14 columns and no changes column' else pg_catalog.format('FAIL: 9 subcases: changes absent; exact column count; keys=%s', v_keys) end);

  raise exception E'TEST RESULTS (expected 9 lines)\n%', pg_catalog.array_to_string(v_results, E'\n');
end
$test$;
```
