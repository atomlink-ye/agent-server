# SESS closed RuntimeSession recovery

## Decision

Implemented option B: closed `runtime_sessions` rows remain durable history.
Migration `0074_runtime_session_closed_successors.sql` changes scope uniqueness to
a partial index for `status <> 'closed'`. The former session and all dependent
specification, generation, turn, and grant records remain FK-addressable.

`PostgresRuntimeSessionStore.findByScope` and its `ON CONFLICT DO NOTHING`
fallback now select only open rows. Concurrent callers therefore both attempt
the transactional insert, one wins, and the loser reads that one open row. The
partial unique index is the concurrency arbiter; no duplicate open successor
can commit.

`EnsureDesiredRuntimeSpecService` treats a closed result as historical and
creates a revision-1 successor. `EnsureRuntimeSession.execute(id, prompt)`
continues to reject an explicitly supplied closed ID: it cannot silently
replace the durable identity a caller chose. Closed-state guards were added to
spec append and generation activation while their existing session row locks
are held, preventing a close race from reviving an old session.

## TDD evidence

The new regression is in
`src/application/runtime/ensure-runtime-session.test.ts` as requested.

Red, before implementation:

```text
FAIL ... closed chat runtime session recovery > creates a successor for a closed scope before a new turn reaches runtime readiness
Error: runtime_session_closed
  at EnsureDesiredRuntimeSpecService.execute
  src/application/runtime/ensure-desired-runtime-spec.ts:29:44
```

Green, after implementation:

```text
Test Files  2 passed (2)
Tests       8 passed (8)
```

## Verification

- `pnpm test:unit`: 200 files passed, 1067 tests passed, 4 skipped. The only
  failure is the documented local conflict in
  `host-native-require-native-postgres.test.ts`; native PostgreSQL is present
  and its default `agent_server_dev` connection resolves instead of rejecting.
- `pnpm web:check:types`: passed.
- `pnpm typecheck`: passed (including Web types).
- `git diff --check`: passed.
- `pnpm lint`: blocked only by 18 pre-existing formatting warnings outside this
  change; none are in the SESS files.

## Existing-data migration verification

Before database mutation, created
`/tmp/agent_server_demo-before-sess-20260909-091810.dump`.

Applied the registered migration to `agent_server_demo` with the repository
migration runner. It completed successfully and the database reports:

```text
0074_runtime_session_closed_successors
runtime_sessions_scope_uq|... WHERE (status <> 'closed'::text)
```

## Browser E2E status

Not performed. Ports 3000/3001 are occupied by the user-designated demo and
its API is watching a separate `code/agent-server` worktree on `master`, not
this `lane/sess` worktree. Altering or restarting that instance would both
modify an unrelated worktree and violate the instruction not to occupy those
ports. The migration was applied to its database, but the running API has not
loaded this code and would not be valid evidence for this fix.
