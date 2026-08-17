# Database: migrations, permissions, backups

Three things live here that are easy to get wrong once and hard to notice: how a
schema change reaches production, what the app's database role is allowed to do,
and whether a backup exists. All three were open items in the beta readiness
audit.

---

## Changing the schema

```bash
pnpm --filter @workspace/db run generate
```

Writes SQL to `./drizzle`. **Read it.** This is the entire point of the change —
a `DROP COLUMN` you did not intend is visible here and nowhere else. Then commit
the SQL alongside the schema change, and apply it:

```bash
pnpm --filter @workspace/db run migrate
```

### Why `push` is no longer the mechanism

`drizzle-kit push` diffs the TypeScript schema against the **live** database and
applies the difference immediately. Nothing is written down, so nothing is
reviewed before it runs and nothing records what shape the database was in
yesterday.

That is not a style preference. `push` resolves a **renamed column as a DROP
plus a CREATE**, so renaming a column in `src/schema/` silently destroys the data
in it. There was also a `push-force` script that skipped the one interactive
confirmation standing between a typo and that outcome; it has been deleted.

`push` is kept for local development against a scratch database, where losing
data costs nothing and the fast loop is worth having. **Never run it against
production.**

### The baseline migration

`0000_baseline_existing_schema.sql` records the schema as it already existed in
production when migrations were adopted. Every statement in it is idempotent
(`CREATE TABLE IF NOT EXISTS`, and the one foreign key wrapped in a
`DO $$ … EXCEPTION WHEN duplicate_object` block), because the database it first
runs against **already has those 22 tables**. Generated as plain `CREATE TABLE`
it would abort on the first one — which is the trap that makes people give up on
migrations and go back to `push`.

It contains no `DROP` of any kind. Applying it cannot lose data.

`0001_operator_controls_and_object_storage.sql` is the first real change: three
new tables (`user_status`, `audit_events`, `usage_daily`), five new columns, and
seven new indexes. Additive only — read it and confirm that for yourself.

> **Not yet verified against a live database.** The idempotency of the baseline
> was established by review, not by execution: there was no Postgres available
> where this was written. Before running it on production, run both migrations
> against a scratch database **twice** and confirm the second run is a clean
> no-op:
>
> ```bash
> DATABASE_URL=<scratch> pnpm --filter @workspace/db run migrate
> DATABASE_URL=<scratch> pnpm --filter @workspace/db run migrate
> ```

---

## The role the app connects as

`src/index.ts` opens a pool with whatever `DATABASE_URL` grants. On a
provisioned Postgres that is normally the **owner**, which can `DROP` anything.
The application needs to read and write its own tables and nothing more.

Create a restricted role and point `DATABASE_URL` at it. Run migrations
separately, as the owner.

```sql
-- Run as the owner, once.
CREATE ROLE vera_app WITH LOGIN PASSWORD 'use-a-generated-secret';

-- Connect and look, but not create schemas.
GRANT CONNECT ON DATABASE <dbname> TO vera_app;
GRANT USAGE ON SCHEMA public TO vera_app;

-- Exactly the four verbs the app performs, on the tables that exist today.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO vera_app;

-- serial primary keys need their sequences.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO vera_app;

-- And on tables a future migration creates, so a new table does not silently
-- 403 the app until someone remembers to re-grant.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vera_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO vera_app;
```

Deliberately **not** granted: `CREATE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`, and
anything on `pg_catalog` beyond the default read. With those withheld, a SQL
injection that got past the ORM still cannot drop a table, and neither can a
mistake.

Verify it took:

```sql
SET ROLE vera_app;
CREATE TABLE should_fail (id int);  -- must error: permission denied
RESET ROLE;
```

---

## Backups

**Confirm this before external users, and write the answers down here.** The
privacy policy commits to a 30-day backup window and 90-day log retention;
both are currently policy statements rather than numbers read off an
infrastructure setting, and an untested restore is not a backup.

| Question | Answer |
| --- | --- |
| Provider and plan | _unconfirmed_ |
| Automated backup frequency | _unconfirmed_ |
| Retention window | _unconfirmed_ — policy says 30 days |
| Point-in-time recovery available? | _unconfirmed_ |
| Last restore test, and how long it took | _never performed_ |

If the real retention is not 30 days, change section 7 of the privacy policy in
the same commit rather than leaving the document wrong.

### On Supabase

Supabase Postgres is ordinary Postgres — adopting it is a `DATABASE_URL` swap
with no code change, and it brings automated daily backups plus point-in-time
recovery on paid plans, which is the cheapest way to close the backup gap. It
also gives a browser SQL editor, which is worth knowing about because it is
currently the only way to answer "what did this user actually do" (see
`artifacts/api-server/src/routes/operator.ts` for the endpoints that replace
most, but not all, of that need).

Use the **pooled** connection string for the app (`?pgbouncer=true` / port 6543)
and the **direct** connection for migrations — `drizzle-kit migrate` runs DDL,
which a transaction pooler will reject.

Supabase Auth is deliberately **not** adopted: Clerk is already wired,
verified, and carries the password, reset, lockout and enumeration defences this
codebase never has to implement. Two identity providers is worse than one.
