# Username/password auth

## Scope and migration

This lane adds username/password registration and login, durable scrypt password
records, hashed HttpOnly browser sessions, server-derived browser identity, and
shared membership in the first enabled service account's tenant/workspace.
Browser-session middleware is composed in the core HTTP app before all browser
BFF registrations, so the standalone server entrypoint is not the only guard.
Existing anonymous browser identities and their conversations are left intact;
there is no destructive conversion or automatic merge. New registrations start
fresh under a durable user principal and can see the common workspace roster.

Migration `0073_username_password_auth.sql` creates `auth_users` and
`auth_sessions`. It is applied by the existing ordered migration runner. No
password or session token is written to logs or returned in responses.

## Rollback

Rollback is an operator decision and is intentionally not automatic at runtime.
First stop writes to the auth routes, verify the target database, and take the
usual database backup. Then, after checking whether any user-created data refers
to the new principals, run:

```sql
BEGIN;
DROP TABLE IF EXISTS auth_sessions;
DROP TABLE IF EXISTS auth_users;
DELETE FROM durable_kernel_schema_migrations
 WHERE version = '0073_username_password_auth';
COMMIT;
```

This removes registered accounts and their sessions but leaves the pre-existing
anonymous identities/conversations untouched. Re-applying the migration is
safe; no migration runner rollback is attempted by the application.

## Verification

- `pnpm typecheck` — passed (server and Web types).
- `pnpm exec vitest run src/application/auth/auth-service.test.ts src/entrypoints/api/routes/browser-account.test.ts src/entrypoints/api/routes/browser-coworkers.test.ts` — passed (12 tests).
- `pnpm exec vitest run src/application/auth src/entrypoints/api/routes/auth.test.ts src/entrypoints/api/routes/browser-context.test.ts src/entrypoints/api/routes/browser-account.test.ts src/entrypoints/api/routes/browser-coworkers.test.ts src/entrypoints/api/routes/browser-web.test.ts` — passed (35 tests), including HTTP cookie issuance/revocation, expiry, spoof rejection, session-derived ContextFS scoping, shared membership, scrypt verification, and plaintext absence.
- The auth service test asserts registration auto-login, scrypt-only persistence,
  absence of plaintext password, duplicate-user rejection, and failed login.

The live local verification used the running 3000/3001/5432 topology after
applying migration 0073. It registered a fresh account, showed its username in
the shared shell, logged out to the login page, and signed in again. The
database query confirmed one shared-workspace membership and a self-describing
scrypt hash which did not contain the submitted password. The resulting
screenshot and sanitized SQL output are retained only under ignored `.local/`
evidence storage; no credential, cookie, token, or hash value is recorded here.
Password hashes use the self-describing `scrypt$v=1$N=32768,r=8,p=3$...`
format.
