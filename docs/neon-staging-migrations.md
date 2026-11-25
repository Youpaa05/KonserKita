# Neon staging migrations

The remote migration runner is restricted to this verified staging target:

- Project: `twilight-block-46431039`
- Branch: `br-lively-glitter-bdluy8ax` (`staging`)
- Database: `neondb`
- Direct endpoint host: `ep-mute-fire-bdv1e9ll.c-8.us-east-2.aws.neon.tech`

The endpoint host is an allowlist, not a credential. If Neon replaces the staging branch or endpoint, stop and verify the replacement through Neon MCP before changing the runner's target constants. The runner does not load `backend/.env`, accept a production target, or support a target override.
The staging entry point creates its own `pg.Pool` only after validating the environment. The internal migration engine accepts an already-connected client for isolated tests and does not create connections.

## Requirements

The Windows PowerShell launcher prompts for the URL as hidden input, exports it
to the child process environment, invokes the existing npm migration script,
and restores any previous process environment values afterward. It does not
write the URL to a file, command argument, or command history.

`NEON_MIGRATION_TARGET` is fixed to `staging` by the launcher.
`NEON_MIGRATION_DATABASE_URL` must be the direct (non-pooled) URL for database
`neondb` on the staging branch.

The URL is not stored in the repository or printed by the runner. In Neon Console, select project **KonserKita**, branch **staging**, database **neondb**, then open **Connect** and choose the direct connection (pooling off). Do not paste the URL into chat, source code, `.env`, or command-line arguments. The runner validates the exact host and database, rejects `-pooler` endpoints, and forces TLS certificate verification.

Application traffic uses the pooled endpoint; this runner requires the direct endpoint because it holds a session-level advisory lock while applying migrations.

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

The runner bootstraps `backend/database/schema.sql` only when there is no tracking table and the database contains only the `public` schema with no user objects. It tolerates only the two exact Neon platform default-privilege entries for `cloud_admin` on `public`; any other default privilege still blocks bootstrap. Bootstrap and its `000` checksum record commit atomically. Each migration 001–011 then runs in numeric order in its own transaction, with its tracking row committed in the same transaction. Re-running skips matching recorded migrations; missing history, unknown versions, changed checksums, a non-empty untracked database, or an unexpected endpoint stops the run.

After a successful run, use a read-only query on the staging branch to inspect `public.schema_migrations` and confirm versions `000` through `011`. Do not infer success from a partial log: the runner prints a final PASS only after all migrations complete and the advisory lock is released.

## Failure and recovery

Bootstrap failure rolls back the bootstrap and its tracking table. A failed migration rolls back that migration only; previously committed versions remain recorded, so the runner can safely skip them after the cause has been reviewed and corrected. Error output includes the phase and safe database error code only, never raw PostgreSQL messages or credentials.

If the database is non-empty but has no tracking table, do not bypass the guard or create tracking records by hand. Stop and compare the schema/checksum history with an approved procedure. For an unrecoverable staging state, preserve any needed evidence and obtain approval before restoring/recreating the staging branch from production. The staging runner must never be used on production.

Migrations have only been reviewed statically and exercised with mocks; this document does not claim PostgreSQL runtime validation. No migration is run automatically by Netlify.

## Production runner

Production uses a separate, exact-target runner. It accepts only the direct
endpoint `ep-delicate-hall-bdjuqrzi.c-8.us-east-2.aws.neon.tech`, database
`neondb`, role `neondb_owner`, port `5432`, and a URL with `sslmode=require`
or `sslmode=verify-full`. It rejects pooled endpoints and forces TLS
certificate verification.

From the repository root, run this only after the production change is
approved and the database target has been confirmed:

```powershell
npm --prefix backend run db:migrate:neon:production:windows
```

The PowerShell launcher requests the direct production URL with hidden
`SecureString` input, passes it only through the child process environment,
and restores the prior process environment afterward. Never put the URL in
source, a file, command arguments, or chat. The runner uses the same migration
engine as staging: it bootstraps the baseline only on a truly empty database,
then verifies and applies migrations 001–011 in order with checksums,
transactions, and an advisory lock. It does not execute `seed.sql`. If a
database has an unknown structure or inconsistent migration history, it stops
without bypassing the guard. Automated tests do not run the production
migration; a passing test result is not proof that production has been
migrated.
