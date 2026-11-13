# CEIT Connect backup runbook

> **At a glance**
>
> A backup is a private copy of the council's database that can help recover information after a serious mistake or failure. A normal run usually takes about 15–30 minutes; the first run can take longer while tools download. Beforehand, you need Docker Desktop and WSL installed, Docker running, Git Bash, the Prod database connection string, and access to the Supabase SQL Editor. The council chooses how often backups happen and who is responsible. **Never share the backup files. Never paste the database password or secret connection string anywhere.**

This is the manual backup procedure for CEIT Connect; the council chooses the frequency (see **How often and how long to keep**). It creates a schema export and a separate COPY-format data export for the Prod `public` and `ceit_connect_private` schemas.

The export contains personal data, confidential task content, private run histories, the push delivery queue, and push sender credential data. Store it only in a private folder outside this repository. Never commit, share, upload, paste, or attach either file. Never put a database password, connection string, key, or credential in this document, the proof record, Git, an issue, or chat.

## Plain-language glossary

- **Database dump:** a saved copy of database structure or information.
- **Connection string:** the secret address and login details used to reach the Prod database.
- **Schema file:** `schema.sql`, which describes tables, rules, functions, and other database structure.
- **Data file:** `data.sql`, which contains the saved rows from those tables.
- **Restore:** loading a backup into a recovery database so the information can be used again.
- **Row count:** the number of saved records in one table; matching counts help show that the export is complete.

## Scope and limitations

Included:

- All schema objects and table data in `public`.
- All schema objects and table data in `ceit_connect_private`.

Not included:

- Supabase Auth users, identities, sessions, or sign-in configuration.
- Supabase Storage metadata or stored files.
- Any other Supabase-managed schema.
- Prod `pg_cron` job definitions.
- Supabase dashboard settings, including Auth providers, SMTP, and email templates.
- Vercel environment variables.

Logins are tied to Supabase Auth. This public/private-schema dump cannot restore sign-ins by itself. Auth and Storage recovery are known limitations for the later restore drill; this runbook does not invent an export method for either one. Recreate cron jobs, dashboard settings, and Vercel environment variables from their own project documentation and private operational records.

## Repeat backups (quick path)

One-time setup is not repeated: do not reinstall Docker Desktop or WSL or rerun the `db dump --help` flag check unless the Supabase CLI version changed. For every backup, make sure Docker is running; open a new Git Bash window; follow **Export Prod** for the connection-string prompt, a new uniquely dated UTC folder with seconds in its name, both dumps, and `unset`; follow **Check the local files and count exported rows**; follow **Count live Prod rows** and compare the results; then add a new dated proof entry without replacing an older proof. The fixed private root folder is reused, but each dated backup folder must be newly created.

## How often and how long to keep

The council chooses the schedule. Weekly is recommended; twice a week is fine during busy periods. Monthly is acceptable, with the trade-off that more data can be lost between backups. Always take a backup before any migration or Prod push and after a big event ends.

Recommended retention defaults, which the council may change: keep the latest four regular backups plus the backup taken just before each big migration for about one month. Securely delete older backups and empty the Recycle Bin because every copy contains personal and confidential data. Each backup is a full new copy in its own dated folder; never append to or overwrite an older backup.

## Why this method

Use Docker Desktop with `npx supabase db dump`. It produces a restorable PostgreSQL schema/data export without installing PostgreSQL client tools locally.

Realistic alternatives are less suitable:

- Native `pg_dump` can make the same kind of export, but it requires local PostgreSQL client tools.
- Dashboard CSV export needs only the Supabase dashboard, but it is table-by-table data only and does not preserve schema objects, functions, policies, or a complete recovery path.
- A managed or dashboard backup download would be convenient, but its current free-tier availability and exact dashboard labels were not verified offline. This runbook does not rely on it.

Docker Desktop, Node.js/npm, and internet access for any missing CLI package or Docker image are required. The first Docker-backed dump can take longer while its image downloads.

## Before the first export

1. Install Docker Desktop and WSL if needed, then open Docker Desktop and wait until it reports that Docker is running. After installing them, open a **new Git Bash window** before exporting.
2. In that new Git Bash window, check that Docker is available:

   ```bash
   docker --version
   ```

   If Git Bash says Docker is missing from `PATH`, restart Windows or sign out and back in. Then open another new Git Bash window. If it is still missing, run this PATH fix and retry `docker --version`:

   ```bash
   export PATH="$PATH:$LOCALAPPDATA/Programs/DockerDesktop/resources/bin:/c/Program Files/Docker/Docker/resources/bin"
   ```

3. In Git Bash, run only this help check first:

   ```bash
   npx supabase db dump --help
   ```

4. Confirm that the installed help shows all of these flags before continuing:

   - `--db-url` for an explicit database connection string;
   - `--schema` for selecting schemas;
   - `--file` for the output file;
   - `--data-only` for the separate data export; and
   - `--use-copy` for COPY-format rows.

   The commands below use only those flags. If the help output uses different names or does not show one of them, stop and update this runbook for the installed CLI version before exporting. Do not guess a replacement flag.

5. In the Supabase dashboard, open the **Prod** project and obtain a PostgreSQL connection string. Do not relink the CLI: this repository normally remains linked to Dev. Prefer the free-tier **Session pooler on port 5432** when a direct connection is unavailable; the pooler may be required on networks without working IPv6. Do not use the Transaction pooler on port 6543 for `pg_dump`.
6. Confirm visually that the connection string contains the Prod project ref `mgeoqfzsfgbxnujywdnu`. If it does not, stop.
7. Insert the database password only in your own local copy of the connection string. Percent-encode password characters that have special meaning in a URL. For example, use `%40` for `@`, `%3A` for `:`, `%2F` for `/`, `%23` for `#`, and `%25` for `%`. Never paste the resulting connection string into chat or the proof record.
8. Keep the backup under the fixed private folder described below, outside the repository folder. Use a Windows account and device that only authorized people can access, preferably with device encryption. Do not use a repository subfolder even though `.gitignore` has backup safety entries.

## Export Prod

Do not paste this section as one large block. Git Bash can let a silent `read` consume later pasted lines, and multi-line command continuations can be mangled. Paste each small command below separately and wait for it to finish before continuing.

First paste only this one-line connection-string prompt, then type or paste the URL-encoded Prod connection string and press Enter:

```bash
read -rsp "Paste the URL-encoded Prod database connection string: " CEIT_PROD_DB_URL; printf '\n'
```

Check the project ref without printing the connection string:

```bash
[[ "$CEIT_PROD_DB_URL" == *mgeoqfzsfgbxnujywdnu* ]] && printf 'Prod project ref confirmed.\n' || printf 'STOP: wrong project ref; do not run either dump.\n' >&2
```

If the check says `STOP`, run `unset CEIT_PROD_DB_URL` and start again. Otherwise, paste this one-line folder command. It reuses or creates the fixed private root, gives the new backup a UTC stamp including seconds, and refuses to accept an existing dated folder. Git Bash ignored `TZ=Asia/Manila` during the real run, so the folder stamp is deliberately and honestly UTC. Write the Philippine date and time in the proof record by hand.

```bash
CEIT_BACKUP_ROOT="$HOME/CEIT-Connect-Private-Backups"; mkdir -p "$CEIT_BACKUP_ROOT" && CEIT_BACKUP_DIR="$CEIT_BACKUP_ROOT/ceit-connect-prod-$(date -u +%Y-%m-%d-%H%M%S)" && mkdir "$CEIT_BACKUP_DIR" && printf 'New private backup folder created with a UTC stamp.\n' || { printf 'STOP: could not create a new dated backup folder; do not run either dump.\n' >&2; unset CEIT_BACKUP_DIR; }
```

From immediately before the schema dump until after the live row counts are taken, do not run any migration, Prod push, or deployment. If one happens during that window, discard this backup and repeat the whole export so the schema, data, and live comparison describe one unchanged Prod state.

Paste the schema dump as one long line and wait for it to succeed. The destination guard stops the command if the dated folder variable is empty:

```bash
npx supabase db dump --db-url "$CEIT_PROD_DB_URL" --schema public,ceit_connect_private --file "${CEIT_BACKUP_DIR:?STOP: CEIT_BACKUP_DIR is empty; create the dated backup folder first.}/schema.sql"
```

Only after the schema dump succeeds, paste the data dump as one long line and wait for it to succeed. It uses the same empty-variable guard:

```bash
npx supabase db dump --db-url "$CEIT_PROD_DB_URL" --schema public,ceit_connect_private --data-only --use-copy --file "${CEIT_BACKUP_DIR:?STOP: CEIT_BACKUP_DIR is empty; create the dated backup folder first.}/data.sql"
```

Finally, clear the connection string with its own paste:

```bash
unset CEIT_PROD_DB_URL
```

These are two separate exports because the plain COPY-format data file is needed for the no-PostgreSQL row-count check below. A successful first command does not make a failed second command acceptable. If either command reports an error, record no successful proof and retry only after resolving it.

The secret is typed only into your terminal's silent prompt. The literal connection string is not placed in shell history, but it exists in the temporary shell variable and may be passed to the local CLI process while the command runs. Clear it with `unset CEIT_PROD_DB_URL`, as shown, and close that terminal after finishing. If either dump fails or you interrupt the pasted block, run `unset CEIT_PROD_DB_URL` by hand before doing anything else.

CLI error output may include the connection string. Never paste or share that output unless the entire connection string has been removed first.

> **If something goes wrong**
>
> - **Docker is not found:** open a new Git Bash window, restart or sign out if Docker was just installed, then use the documented PATH fix.
> - **The password is rejected or login fails:** stop, recheck the Prod Session pooler connection and URL-encoded password, and never share the error until its connection string is removed.
> - **The row counts do not match:** the backup does not pass; retry during a quiet period and compare again.
> - **Anything unexpected happens:** stop and ask the owner before continuing.

## Check the local files and count exported rows

First confirm that both files exist and are non-empty:

```bash
if [ ! -s "$CEIT_BACKUP_DIR/schema.sql" ] || [ ! -s "$CEIT_BACKUP_DIR/data.sql" ]; then
  printf 'ERROR: schema.sql or data.sql is missing or empty.\n' >&2
  false
else
  wc -c "$CEIT_BACKUP_DIR/schema.sql" "$CEIT_BACKUP_DIR/data.sql"
fi
```

Open the private folder in a local text editor and confirm that both files open as SQL text. Do not copy their contents into chat. Then run this Git Bash command. It handles Windows CRLF endings, counts rows inside every `public` and `ceit_connect_private` COPY block, and exits unsuccessfully if a COPY block lacks its `\.` terminator:

```bash
awk '{sub(/\r$/,"")} !c && /^COPY "(public|ceit_connect_private)"\./ {t=$2; gsub(/"/,"",t); n[t]=0; c=1; next} c && $0=="\\." {c=0; next} c {n[t]++} END {if(c){print "ERROR unterminated COPY for " t > "/dev/stderr"; bad=1} for(k in n) printf "%s|%d\n",k,n[k]; if(bad) exit 1}' "$CEIT_BACKUP_DIR/data.sql" | sort | tee "$CEIT_BACKUP_DIR/exported-row-counts.txt"

if [ "${PIPESTATUS[0]}" -ne 0 ]; then
  printf 'ERROR: exported row counting failed; do not accept this backup.\n' >&2
  false
fi
```

PostgreSQL COPY text represents embedded line breaks as escaped text, so each physical line inside a COPY block is one exported row. `exported-row-counts.txt` is sensitive backup metadata and stays in the same private folder.

The real Supabase CLI data dump uses quoted headers such as `COPY "public"."users" (...)`. After the script removes quotes, the expected output is exactly 31 lines shaped like `public.users|12` or `ceit_connect_private.push_delivery_queue|0`—one `schema.table|count` line for every exported table.

## Count live Prod rows

Immediately after the export, open the Prod project SQL Editor and run the single read-only `SELECT` below. It discovers every ordinary or partitioned table in both selected schemas from the PostgreSQL catalog, so a newly added table cannot be silently omitted. `query_to_xml` executes only a generated `select count(*)` for each discovered table. The statement performs no DDL and writes nothing.

```sql
select format(
         '%s.%s|%s',
         namespace.nspname,
         relation.relname,
         ((pg_catalog.xpath(
           '//count/text()',
           pg_catalog.query_to_xml(
             format(
               'select count(*) as count from %I.%I',
               namespace.nspname,
               relation.relname
             ),
             false,
             true,
             ''
           )
         ))[1])::text
       ) as table_and_row_count
from pg_catalog.pg_class as relation
join pg_catalog.pg_namespace as namespace
  on namespace.oid = relation.relnamespace
where namespace.nspname in ('public', 'ceit_connect_private')
  and relation.relkind in ('r', 'p')
order by namespace.nspname, relation.relname;
```

In the SQL Editor result grid, copy only the exact `schema.table|count` values, without the column heading. The expected successful shape is 31 lines covering the same 31 tables as the export. You may paste the two exact count lists into a reviewer chat for comparison, or save the live lines to a private file and compare locally as follows. Do not share any dump contents or secrets.

In Git Bash, create a live-count file in the same private folder, paste those lines, then press **Ctrl+D** on a new line to finish:

```bash
cat > "$CEIT_BACKUP_DIR/live-row-counts.txt"
```

Strip carriage returns from both files, then sort independent copies using byte-stable ordering and compare them. This prevents Windows clipboard line endings from causing a false difference.

```bash
tr -d '\r' < "$CEIT_BACKUP_DIR/exported-row-counts.txt" | LC_ALL=C sort > "$CEIT_BACKUP_DIR/exported-row-counts.sorted.txt"
tr -d '\r' < "$CEIT_BACKUP_DIR/live-row-counts.txt" | LC_ALL=C sort > "$CEIT_BACKUP_DIR/live-row-counts.sorted.txt"
LC_ALL=C diff -u "$CEIT_BACKUP_DIR/exported-row-counts.sorted.txt" "$CEIT_BACKUP_DIR/live-row-counts.sorted.txt"
```

An empty `diff` output means that the table inventories and every row count match. Any output means the proof does not pass. Compare the two sorted files by eye only if `diff` itself is unavailable.

- Every live table in both schemas must appear in the exported list.
- Every exported table must appear in the live list.
- Every row count must match.
- If a live table with zero rows is missing from the export, stop and ask the reviewer. Do not assume that omitting an empty table is acceptable.

Prod can change between the dump's transaction snapshot and the live query. If a count differs, do not edit or explain away the number. Repeat the export and immediate live-count query during a quiet period. Only an exact comparison is accepted for the O1 proof.

## Proof record

Fill this in only after you run the real Prod export. Do not place the connection string, password, file contents, push credentials, or private folder's full path here.

- Date and Philippine time: `2026-11-12, about 14:12 Philippine time`
- Environment: `Prod`
- Method: `Docker-backed npx supabase db dump; public + ceit_connect_private; separate schema and COPY-format data exports`
- Private filename(s), names only: `schema.sql and data.sql, in the folder ceit-connect-prod-2026-11-12-0610 (folder stamp is UTC)`
- Schema file size: `793,332 bytes`
- Data file size: `322,031 bytes`
- Operator: `owner`
- Local open/integrity check: `both files open as SQL text; all 31 COPY blocks terminated with no error`
- Exported versus live table inventory: `31 of 31 tables in both lists, none missing either way`
- Exported versus live row counts: `all 31 counts identical (compared by pasted lists)`
- Overall result: `PASS`
- Notes: `the circular-FK warning on tasks (see recovery outline); stamp is UTC; the backup is stored on one PC only; Auth users and Storage files are not covered.`
- Sensitive-content acknowledgement: `I confirmed the private dump contains personal data, confidential task content, and push sender credential data and was stored privately and never shared. Confirmed by the owner, 2026-11-12.`

## Ownership and handoff

- Who runs the backup: `____________________`
- How often: `____________________`
- Where the private copy is kept and who else can access it: `____________________`
- Who can restore: `____________________`
- Who holds Supabase and Vercel access: `____________________`

## Restore drill

Run this drill once now, then repeat it after every big database change. Restore
only into a throwaway PostgreSQL container on the owner's PC. Never restore
into Dev, Prod, or another cloud project. The existing export procedure is the
only place where the Prod connection string is used.

Use a plain PostgreSQL Docker container. A local Supabase stack would provide
more services, but it is heavier and unnecessary for proving these two dump
files. The plain container is the one recommended path.

The restored rows contain real member information, confidential task content,
private run history, and push credentials. Keep every dump, log, and result in
the private backup folder outside this repository. Never commit, share, paste,
or attach them. The container publishes no port and uses Docker's `none`
network, so it cannot accept connections from this PC or another machine. Its
password is generated for this drill, never typed, and discarded with the
container.

Use a backup taken on the same Philippine calendar day as this drill. Run the
Prod object-count `SELECT` during the same proof window, with no migration or
Prod push between the export and that `SELECT`. If the backup is older or the
database changed between those steps, catalog-count differences are expected
and harmless; take a fresh backup instead of treating that comparison as a
restore failure.

### Prepare the private files and matching PostgreSQL image

Open Docker Desktop, wait until it is running, and open Git Bash. Paste one
short command at a time and wait for it to finish. A silent or interactive read
can otherwise consume later pasted lines.

```bash
export MSYS_NO_PATHCONV=1
```

Git Bash otherwise rewrites a bare container path such as `/restore` into a
Windows path for `docker exec`, which breaks `docker exec ... mkdir -p /restore`.

List the available private backup folders first:

```bash
ls -1 "$HOME/CEIT-Connect-Private-Backups"
```

If you are still in the Git Bash window used for the export, `CEIT_BACKUP_DIR` is already set; skip to the file check. Otherwise paste this with your real folder name:

```bash
CEIT_BACKUP_DIR="$HOME/CEIT-Connect-Private-Backups/ceit-connect-prod-YYYY-MM-DD-HHMMSS"
```

The `read` command does not expand `$HOME`, so do not type `$HOME` at a `read` prompt.

```bash
test -s "$CEIT_BACKUP_DIR/schema.sql" && test -s "$CEIT_BACKUP_DIR/data.sql" && printf 'Both dump files are present.\n' || { printf 'STOP: a dump file is missing or empty.\n' >&2; false; }
```

The PostgreSQL major version must match the dump header:

```bash
grep -m1 '^-- Dumped from database version ' "$CEIT_BACKUP_DIR/schema.sql"
```

```bash
CEIT_PG_MAJOR="$(grep -m1 '^-- Dumped from database version ' "$CEIT_BACKUP_DIR/schema.sql" | awk '{split($6,v,"."); print v[1]}')"
```

```bash
test -n "$CEIT_PG_MAJOR" || { printf 'STOP: the dump major version was not found.\n' >&2; false; }
```

Pin the major tag; never use `latest` or a different major:

```bash
CEIT_PG_IMAGE="postgres:${CEIT_PG_MAJOR}"
```

```bash
printf 'Using %s to match the dump major version.\n' "$CEIT_PG_IMAGE"
```

```bash
docker pull "$CEIT_PG_IMAGE"
```

Generate a throwaway password without printing it:

```bash
CEIT_RESTORE_PASSWORD="$(openssl rand -hex 24)"
```

Start the isolated container with no published port:

```bash
docker run --name ceit-connect-restore-drill --network none -e POSTGRES_PASSWORD="$CEIT_RESTORE_PASSWORD" -d "$CEIT_PG_IMAGE"
```

```bash
unset CEIT_RESTORE_PASSWORD
```

```bash
until docker logs ceit-connect-restore-drill 2>&1 | grep -q 'PostgreSQL init process complete; ready for start up'; do sleep 1; done
```

That log line proves the image's first-start initialization finished. Now wait
for the restarted server to accept connections. If this log wait runs longer
than two minutes, press **Ctrl+C** and check `docker logs ceit-connect-restore-drill`.

```bash
until docker exec ceit-connect-restore-drill pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
```

The drill deliberately uses the container's anonymous data volume instead of a
named mount because the image's data-directory layout differs between
PostgreSQL major versions.

```bash
docker exec ceit-connect-restore-drill mkdir -p /restore
```

Git Bash may rewrite container paths into Windows paths. Convert each local
source explicitly and disable conversion only for `docker cp`. Do not bind
mount the Windows backup folder.

```bash
CEIT_SCHEMA_FILE="$(cygpath -w "$CEIT_BACKUP_DIR/schema.sql")"
```

```bash
CEIT_DATA_FILE="$(cygpath -w "$CEIT_BACKUP_DIR/data.sql")"
```

```bash
MSYS_NO_PATHCONV=1 docker cp "$CEIT_SCHEMA_FILE" ceit-connect-restore-drill:/restore/schema.sql
```

```bash
MSYS_NO_PATHCONV=1 docker cp "$CEIT_DATA_FILE" ceit-connect-restore-drill:/restore/data.sql
```

### Create the minimum Supabase stand-ins

The selected dump omits Supabase-managed Auth objects and extensions that its
foreign keys and function bodies reference. Create these stand-ins before
loading `schema.sql`: roles `anon`, `authenticated`, and `service_role`;
schemas `auth` and `extensions`; minimal `auth.users`; `auth.uid()` and
`auth.role()` with the correct return types; and `pgcrypto` installed in
`extensions` for the three functions that call `extensions.digest`.

```bash
docker exec ceit-connect-restore-drill psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE ROLE anon NOLOGIN;"
```

```bash
docker exec ceit-connect-restore-drill psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE ROLE authenticated NOLOGIN;"
```

```bash
docker exec ceit-connect-restore-drill psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE ROLE service_role NOLOGIN;"
```

```bash
docker exec ceit-connect-restore-drill psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE SCHEMA auth; CREATE SCHEMA extensions;"
```

```bash
docker exec ceit-connect-restore-drill psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE EXTENSION pgcrypto WITH SCHEMA extensions;"
```

```bash
docker exec ceit-connect-restore-drill psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE TABLE auth.users (id uuid PRIMARY KEY);"
```

```bash
docker exec ceit-connect-restore-drill psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT NULL::uuid';"
```

```bash
docker exec ceit-connect-restore-drill psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS 'SELECT NULL::text';"
```

These objects only let the schema load. They are not Supabase Auth.

### Load the schema and classify every error

Load `schema.sql` first without stopping at its first error so the owner gets a
complete error inventory:

```bash
docker exec ceit-connect-restore-drill sh -c 'psql -U postgres -d postgres -f /restore/schema.sql > /restore/schema-load.log 2>&1; exit 0'
```

```bash
MSYS_NO_PATHCONV=1 docker cp ceit-connect-restore-drill:/restore/schema-load.log "$(cygpath -w "$CEIT_BACKUP_DIR/schema-load.log")"
```

```bash
grep -Ec '(^|: )ERROR:' "$CEIT_BACKUP_DIR/schema-load.log"
```

```bash
grep -nE '(^|: )ERROR:' "$CEIT_BACKUP_DIR/schema-load.log"
```

Expected harmless candidates are unavailable `pg_net`, `supabase_vault`, or
`cron` objects; a missing `supabase_realtime` publication when the schema dump
contains publication membership; plus ownership or grants for Supabase-owned
roles that this isolated recovery database does not use. An error is harmless
only if the live object-count comparison below proves it caused no loss in
either backed-up schema. Missing required tables, functions, policies, triggers,
indexes, or constraints; malformed SQL; and unexplained errors fail the drill.

The first real drill must confirm this list. Update this section with the exact
harmless errors the owner actually sees; never silently accept a new error.

```bash
docker exec ceit-connect-restore-drill psql -U postgres -d postgres -At -c "SELECT to_regclass('public.users'), to_regclass('public.tasks');"
```

Both names must print before continuing.

### Load the data safely

Load `data.sql` second with stop-on-error. The circular warning comes from the
real self-reference `public.tasks.depends_on_task_id` to `public.tasks.id`.
Trigger-backed foreign-key checks are relaxed only in this one scratch session;
the setting disappears when the session ends.

```bash
docker exec ceit-connect-restore-drill sh -c 'psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "SET session_replication_role = replica;" -f /restore/data.sql > /restore/data-load.log 2>&1'
```

If that command fails, stop. Do not edit the dump.

```bash
MSYS_NO_PATHCONV=1 docker cp ceit-connect-restore-drill:/restore/data-load.log "$(cygpath -w "$CEIT_BACKUP_DIR/data-load.log")"
```

```bash
grep -Ec '(^|: )ERROR:' "$CEIT_BACKUP_DIR/data-load.log"
```

The data error count must be `0`.

Copy only the restored profile UUIDs into the stand-in Auth table so its
foreign key has targets:

```bash
docker exec ceit-connect-restore-drill psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "INSERT INTO auth.users (id) SELECT id FROM public.users ON CONFLICT (id) DO NOTHING;"
```

No real Auth row, email, password hash, identity, session, refresh token, or
provider record is restored.

```bash
docker exec ceit-connect-restore-drill psql -U postgres -d postgres -At -c "SELECT (SELECT count(*) FROM auth.users), (SELECT count(*) FROM public.users);"
```

The two counts must match.

```bash
docker exec ceit-connect-restore-drill psql -U postgres -d postgres -At -c "SHOW session_replication_role;"
```

The result must be `origin`. Both foreign keys were created as valid constraints
on empty tables during the schema load, so `VALIDATE CONSTRAINT` after the
relaxed data load would do nothing. The real restored-row checks are the two
orphan-count queries and the invalid-dependency query below.

```bash
docker exec ceit-connect-restore-drill psql -U postgres -d postgres -At -c "SELECT count(*) FROM public.users u LEFT JOIN auth.users a ON a.id=u.id WHERE a.id IS NULL;"
```

```bash
docker exec ceit-connect-restore-drill psql -U postgres -d postgres -At -c "SELECT count(*) FROM public.tasks t LEFT JOIN public.tasks d ON d.id=t.depends_on_task_id WHERE t.depends_on_task_id IS NOT NULL AND d.id IS NULL;"
```

Both orphan counts must be `0`.

```bash
docker exec ceit-connect-restore-drill psql -U postgres -d postgres -At -c "SELECT count(*) FROM public.tasks t JOIN public.tasks d ON d.id=t.depends_on_task_id WHERE t.id=d.id OR t.event_id IS DISTINCT FROM d.event_id;"
```

The invalid dependency count must be `0`.

```bash
docker exec ceit-connect-restore-drill psql -U postgres -d postgres -At -c "SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname IN ('public','ceit_connect_private') AND NOT c.convalidated;"
```

The unvalidated constraint count must be `0` as a catalog sanity check only. It
does not re-check any restored rows or prove that other foreign keys are
healthy. The two orphan counts and invalid-dependency count above are the real
data checks. That limited proof is accepted because `schema.sql` and `data.sql`
come from one consistent database snapshot; the drill is not evidence that
arbitrary edited dump data would satisfy every foreign key.

### Compare row counts

Save the exact catalog-driven query from **Count live Prod rows** in the private
backup folder. Paste this command, paste the SQL shown below, then press
**Ctrl+D** on a new line:

```bash
cat > "$CEIT_BACKUP_DIR/restored-row-counts.sql"
```

```sql
select format(
         '%s.%s|%s',
         namespace.nspname,
         relation.relname,
         ((pg_catalog.xpath(
           '//count/text()',
           pg_catalog.query_to_xml(
             format(
               'select count(*) as count from %I.%I',
               namespace.nspname,
               relation.relname
             ),
             false,
             true,
             ''
           )
         ))[1])::text
       ) as table_and_row_count
from pg_catalog.pg_class as relation
join pg_catalog.pg_namespace as namespace
  on namespace.oid = relation.relnamespace
where namespace.nspname in ('public', 'ceit_connect_private')
  and relation.relkind in ('r', 'p')
order by namespace.nspname, relation.relname;
```

Convert the local query path for Docker Desktop:

```bash
CEIT_ROW_COUNTS_SQL="$(cygpath -w "$CEIT_BACKUP_DIR/restored-row-counts.sql")"
```

Copy the query into the container:

```bash
MSYS_NO_PATHCONV=1 docker cp "$CEIT_ROW_COUNTS_SQL" ceit-connect-restore-drill:/restore/restored-row-counts.sql
```

Run it with stop-on-error and write the result inside the container:

```bash
docker exec ceit-connect-restore-drill sh -c 'psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At -f /restore/restored-row-counts.sql > /restore/restored-row-counts.txt'
```

Copy the result back into the private backup folder:

```bash
MSYS_NO_PATHCONV=1 docker cp ceit-connect-restore-drill:/restore/restored-row-counts.txt "$(cygpath -w "$CEIT_BACKUP_DIR/restored-row-counts.txt")"
```

```bash
tr -d '\r' < "$CEIT_BACKUP_DIR/restored-row-counts.txt" | LC_ALL=C sort > "$CEIT_BACKUP_DIR/restored-row-counts.sorted.txt"
```

Compare it with the live counts captured when the backup was taken, using the
same byte-stable diff method as the export proof:

```bash
LC_ALL=C diff -u "$CEIT_BACKUP_DIR/live-row-counts.sorted.txt" "$CEIT_BACKUP_DIR/restored-row-counts.sorted.txt"
```

An empty diff is required for every `public` and `ceit_connect_private` table,
including zero-row tables.

### Compare live and restored object counts

In the **Prod SQL Editor**, run this one read-only `SELECT`. It returns only six
catalog counts and the twelve non-sensitive committee names—no member or task
data. Run it on the same day as the export, before any migration or Prod push.
Do not use a connection string or run any write:

```sql
select (pg_catalog.jsonb_build_object(
  'tables', (select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'ceit_connect_private') and c.relkind in ('r', 'p')),
  'functions', (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'ceit_connect_private') and p.prokind = 'f'),
  'policies', (select count(*) from pg_catalog.pg_policy p join pg_catalog.pg_class c on c.oid = p.polrelid join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'ceit_connect_private')),
  'triggers', (select count(*) from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid = t.tgrelid join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'ceit_connect_private') and not t.tgisinternal),
  'indexes', (select count(*) from pg_catalog.pg_index i join pg_catalog.pg_class c on c.oid = i.indrelid join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'ceit_connect_private')),
  'constraints', (select count(*) from pg_catalog.pg_constraint c join pg_catalog.pg_namespace n on n.oid = c.connamespace where n.nspname in ('public', 'ceit_connect_private')),
  'committees', (select pg_catalog.jsonb_agg(name order by name) from public.committees)
))::text as restore_catalog_proof;
```

Copy only the JSON value, without its column heading, into a private file. In
Git Bash, paste this command, paste the one JSON line, then press **Ctrl+D** on a
new line:

```bash
cat > "$CEIT_BACKUP_DIR/live-object-counts.txt"
```

Save the same counts-only query in the private backup folder. Paste this
command, paste the exact `SELECT` above, then press **Ctrl+D** on a new line:

```bash
cat > "$CEIT_BACKUP_DIR/restored-object-counts.sql"
```

Convert its path:

```bash
CEIT_OBJECT_COUNTS_SQL="$(cygpath -w "$CEIT_BACKUP_DIR/restored-object-counts.sql")"
```

Copy it into the container:

```bash
MSYS_NO_PATHCONV=1 docker cp "$CEIT_OBJECT_COUNTS_SQL" ceit-connect-restore-drill:/restore/restored-object-counts.sql
```

Run it with stop-on-error and write the result inside the container:

```bash
docker exec ceit-connect-restore-drill sh -c 'psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At -f /restore/restored-object-counts.sql > /restore/restored-object-counts.txt'
```

Copy the result back into the private backup folder:

```bash
MSYS_NO_PATHCONV=1 docker cp ceit-connect-restore-drill:/restore/restored-object-counts.txt "$(cygpath -w "$CEIT_BACKUP_DIR/restored-object-counts.txt")"
```

```bash
tr -d '\r' < "$CEIT_BACKUP_DIR/live-object-counts.txt" > "$CEIT_BACKUP_DIR/live-object-counts.normalized.txt"
```

```bash
tr -d '\r' < "$CEIT_BACKUP_DIR/restored-object-counts.txt" > "$CEIT_BACKUP_DIR/restored-object-counts.normalized.txt"
```

```bash
LC_ALL=C diff -u "$CEIT_BACKUP_DIR/live-object-counts.normalized.txt" "$CEIT_BACKUP_DIR/restored-object-counts.normalized.txt"
```

The diff must be empty. This comparison catches silent table, function,
policy, trigger, index, or constraint loss caused by a tolerated schema error,
and proves that all twelve committee names exist.

If the SQL Editor displays the JSON text with different spacing, compare the
six count values and committee-name list by eye instead of treating whitespace
as a database difference.

If any count differs:

1. Do not edit the dump or restored rows.
2. Check whether the backup and Prod object-count proof were taken on the same
   day and whether a migration or Prod push happened between them. If not,
   differences are expected and harmless; take a fresh backup and proof.
3. Otherwise, re-take the complete backup during a quiet period.
4. Stop and ask for review before attempting any fix.

The drill passes only when the data error count is zero, every schema error is
classified, the row-count and object-count diffs are empty, constraint checks
pass, and all twelve committees appear. Record the real result in
`docs/phase-5/step-b2-restore-drill.md`; do not invent it.

### Cleanup

```bash
docker rm -fv ceit-connect-restore-drill
```

```bash
docker ps -a --filter name=ceit-connect-restore-drill
```

No matching container should remain. The `-v` removal also deletes the
container's anonymous data volume. Keep or securely delete the dumps, logs, and
count files together under **How often and how long to keep**. When a dated
backup ages out, delete its private folder and empty the Recycle Bin. Never
move drill files into the repository before deleting them.

## What a real disaster means

This backup can recover the included `public` and `ceit_connect_private`
objects and rows, but not the complete Supabase project. Members would have to
be re-invited to rebuild sign-ins. Avatars and other Storage files would have
to be uploaded again. Prod cron jobs, Auth and SMTP settings, providers, email
templates, and other dashboard settings would have to be recreated from
separate private operational records.

There is also an unresolved identity problem: restored `public.users` rows
refer to old Supabase Auth UUIDs. Re-inviting someone can create a new Auth
UUID, so the restored profile would not automatically belong to the new Auth
account. The UUID-only drill rows are placeholders, not real accounts, and do
not solve disaster recovery. Identity reconciliation is a later decision. Do
not invent an Auth export or rewrite user IDs during this drill.
