# Neon staging migrations

## Current project: KonserKitah

- Project: `silent-hat-21218854` (`KonserKitah`)
- Branch: `br-quiet-river-bda1sb4d` (`staging`)
- Database: `neondb`
- Pooled endpoint identity: `ep-dark-dawn-bdayxwt3-pooler.c-8.us-east-2.aws.neon.tech`

The runner accepts only that exact pooled hostname or its explicitly paired
direct hostname. A pooled URL identifies the target; the runner always changes
the connection host to the allowlisted direct endpoint before creating `pg.Pool`.
It does not connect through PgBouncer. Runtime validation checks the hostname
allowlist and database name; it does not query Neon or independently validate
the project/branch ID. Before the first migration, verify in Neon Console that
the listed project ID and branch ID map to this pooled endpoint and its direct
pair. Do not proceed if that mapping cannot be confirmed. The runner does not
load `backend/.env`.

The previous Neon infrastructure is retained, but its staging hostnames are
rejected by this runner. No old Neon project, branch, or database resource is
changed or removed. Production uses a separate runner and target allowlist.
The staging entry point creates its own `pg.Pool` only after validating the
environment. The internal migration engine accepts an already-connected client
for isolated tests and does not create connections.

## Requirements

The Windows PowerShell launcher prompts for the URL as hidden input, exports it
to the child process environment, invokes the existing npm migration script,
and restores any previous process environment values afterward. It does not
write the URL to a file, command argument, or command history.

`NEON_MIGRATION_TARGET` is fixed to `staging` by the launcher.
`NEON_MIGRATION_DATABASE_URL` must identify database `neondb` on the exact
KonserKitah staging pooler hostname or its explicitly paired direct hostname.
The pooler URL identifies the target; the runner always connects to the direct
hostname. Arbitrary Neon hosts, suffix lookalikes, and the previous staging
hostnames are rejected.

The staging role is pinned to `neondb_owner`. The URL username and PostgreSQL
`current_user` must both match. The engine requires both `USAGE` and `CREATE`
privileges on schema `public`, a read-write session, and PostgreSQL 14 or newer.
The role and live privileges supplied for the new branch have not been
independently checked by this repository audit; confirm them through the
approved process before running the migration.

The URL is not stored in the repository or printed by the runner. In Neon
Console, select project **KonserKitah**, branch **staging**, database
**neondb**, then open **Connect** and choose the direct connection (pooling
off). Do not paste the URL into chat, source code, `.env`, or command-line
arguments. The runner validates the exact host and database and forces TLS
certificate verification.

Application traffic may use the pooled endpoint; this runner connects directly
because it holds a session-level advisory lock while applying migrations.

## Running

From the repository root, confirm the selected Neon branch is `staging` and
that no application is writing to it. Run:

```powershell
npm --prefix backend run db:migrate:neon:windows
```

The prompt accepts the URL only through `Read-Host -AsSecureString`. The
launcher uses PowerShell process environment variables (`$env:...`) in the
same process that launches `npm.cmd`, then runs `npm run db:migrate:neon` from
`backend`. It returns the runner's exit code. On non-Windows systems, set the
two environment variables in the same shell and use
`npm --prefix backend run db:migrate:neon`.

In PowerShell, assigning `$NEON_MIGRATION_DATABASE_URL` creates only a
PowerShell variable; it is not inherited by npm or Node. Use the launcher (or
set `$env:NEON_MIGRATION_DATABASE_URL` in the same process that starts npm).

Bootstrap runs only when there is no tracking table and the defined bootstrap-safety inventory has no application objects: exactly the `public` non-system schema; no relations, routines, user types, extensions, collations, conversions, operators, statistics objects, text-search objects, non-built-in languages, event triggers, publications, subscriptions, replication origins, foreign-data wrappers/servers/user mappings, transforms, database-specific role settings, large objects, or unexpected default privileges. Two Neon default ACL entries are ignored only when their owner, schema, object type, and ACL exactly match the values checked by the engine; any variation blocks bootstrap.

This inventory is deliberately not described as proof that every possible PostgreSQL catalog or cluster-wide object is absent. Unrecognized or unexpected state must be investigated through an approved read-only check before bootstrap; do not bypass the guard. Bootstrap and the `000` checksum record commit atomically. Each migration 001–012 then runs in numeric order in its own transaction, with its tracking row committed in the same transaction. Re-running skips matching recorded migrations; missing history, unknown versions, changed checksums, an unsafe untracked schema, or an unexpected endpoint stops the run.

After a successful run, use a read-only query on the staging branch to inspect `public.schema_migrations` and confirm versions `000` through `012`. Do not infer success from a partial log: the runner prints a final PASS only after all migrations complete and the advisory lock is released.

## Failure and recovery

Bootstrap failure rolls back the bootstrap and its tracking table. A failed migration rolls back that migration only; previously committed versions remain recorded, so the runner can safely skip them after the cause has been reviewed and corrected. Error output includes the phase and safe database error code only, never raw PostgreSQL messages or credentials.

If the database is non-empty but has no tracking table, do not bypass the guard or create tracking records by hand. Stop and compare the schema/checksum history with an approved procedure. For an unrecoverable staging state, preserve any needed evidence and obtain approval before restoring/recreating the staging branch from production. The staging runner must never be used on production.

Migrations have only been reviewed statically and exercised with mocks; this document does not claim PostgreSQL runtime validation. No migration is run automatically by Netlify.

### Paket 03 verification status

The isolated staging-runner, production-runner, and production-seed unit tests
passed 44/44, and `node --check` passed for all five changed JavaScript files.
The tests use fake database clients; no PostgreSQL or Neon connection was made,
and no database migration or seed was run. PostgreSQL 18.7 compatibility and
live branch identity remain unverified.

## Production runner

The KonserKitah `production` branch does not yet have a verified endpoint in
this repository. Do not infer it from the staging hostname or use the existing
production runner for that branch.

The separate production runner remains pinned to the previous Neon
infrastructure. It accepts only the direct endpoint
`ep-delicate-hall-bdjuqrzi.c-8.us-east-2.aws.neon.tech`, database `neondb`,
role `neondb_owner`, port `5432`, and a URL with `sslmode=require` or
`sslmode=verify-full`. It rejects pooled endpoints and forces TLS certificate
verification. Its confirmation variable is separate from the staging
confirmation: `NEON_PRODUCTION_MIGRATION_TARGET=production`; staging uses
`NEON_MIGRATION_TARGET=staging`. Its configured role is not evidence that the
role or its privileges were verified against a live database. The KonserKitah
production branch must not use this old target.

From the repository root, run this only for the previous production target,
after the production change is approved and the database target has been
confirmed:

```powershell
npm --prefix backend run db:migrate:neon:production:windows
```

The PowerShell launcher requests the direct production URL with hidden
`SecureString` input, passes it only through the child process environment,
and restores the prior process environment afterward. Never put the URL in
source, a file, command arguments, or chat. The runner uses the same migration
engine as staging: it bootstraps the baseline only after the configured
bootstrap-safety inventory passes, then verifies and applies migrations
001–012 in order with checksums, transactions, and an advisory lock. It does
not execute `seed.sql`. If a database has an unknown structure or inconsistent
migration history, it stops without bypassing the guard. Automated tests do
not run the production migration; a passing test result is not proof that
production has been migrated.
