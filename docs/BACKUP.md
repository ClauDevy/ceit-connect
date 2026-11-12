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

One-time setup is not repeated: do not reinstall Docker Desktop or WSL, rerun the `db dump --help` flag check unless the Supabase CLI version changed, or recreate the private root folder. For every backup, make sure Docker is running; open a new Git Bash window; follow **Export Prod** for the connection-string prompt, new dated folder, both dumps, and `unset`; follow **Check the local files and count exported rows**; follow **Count live Prod rows** and compare the results; then add a new dated proof entry without replacing an older proof.

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

If the check says `STOP`, run `unset CEIT_PROD_DB_URL` and start again. Otherwise, paste this one-line folder command. Git Bash ignored `TZ=Asia/Manila` during the real run, so the folder stamp is deliberately and honestly UTC. Write the Philippine date and time in the proof record by hand.

```bash
CEIT_BACKUP_DIR="$HOME/CEIT-Connect-Private-Backups/ceit-connect-prod-$(date -u +%Y-%m-%d-%H%M)"; mkdir -p "$CEIT_BACKUP_DIR"; printf 'Private backup folder created with a UTC stamp.\n'
```

Paste the schema dump as one long line and wait for it to succeed:

```bash
npx supabase db dump --db-url "$CEIT_PROD_DB_URL" --schema public,ceit_connect_private --file "$CEIT_BACKUP_DIR/schema.sql"
```

Only after the schema dump succeeds, paste the data dump as one long line and wait for it to succeed:

```bash
npx supabase db dump --db-url "$CEIT_PROD_DB_URL" --schema public,ceit_connect_private --data-only --use-copy --file "$CEIT_BACKUP_DIR/data.sql"
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

## Recovery outline — untested

Recovery means re-importing the latest verified export into an appropriate Supabase recovery target in this order:

1. Restore `schema.sql` first so schemas, tables, functions, policies, and related objects exist.
2. Restore `data.sql` second so the exported rows load into those objects.
3. Recheck the complete table inventory and row counts before treating the recovery as usable.

The real data-only dump warned about circular foreign-key constraints on the `tasks` table. The restore drill must handle that safely, for example by disabling triggers during the data load or restoring into an empty recovery target. This outline has not been tested and deliberately contains no exact restore commands; selecting a safe target, handling ownership/extensions and the circular constraint, and proving an actual import belong to the later restore-drill batch. Supabase Auth sign-ins, Auth configuration, Storage metadata, and stored files cannot be recovered from these two exports.
