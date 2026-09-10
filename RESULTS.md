# Run-scoped conversation results

Branch: `workui2/ia-a`. Verified starting HEAD: `239fa8ab`. No PR requested or opened. The explicit brief authorizes committing this temporary report; the manager will remove it before the PR.

## Implementation

- Once a Run exists, new preparation messages return `409 work_run_required`; preparation retries cannot restart intake. Accepted requests remain replayable and preparation history remains readable.
- User messages and Lead replies persist `work_run_id`. List and retry operate on exactly one Run or the NULL preparation bucket. Work-wide sequence and lease scheduling are retained.
- Public API and browser facade expose GET/POST `/works/:workId/runs/:runId/chat` and POST `.../chat/:messageId/retry`. Both layers validate path IDs. The public API authorizes the owner/Work/Run relationship before calling chat services.
- The strict POST body remains `{body, client_request_id}`; the URL owns scope. Safe message/list contracts expose nullable `work_run_id`, optional for compatibility with older response fixtures. Preparation reads retain the original endpoint and metadata.
- Existing Work-wide client-key uniqueness is retained. Reuse in a different conversation or with changed text returns `409 idempotency_conflict`, without disclosing the other bucket's message.
- Run chat resolves a single-worker executor from the bound root Task, or a team executor from the persisted TeamRun's sole lead TeamMemberRun. It never invents a lead field or substitutes the Work's current Definition for a Run executor. Preparation still uses its Definition participant and intake behavior.
- Each Run uses runtime scope `{kind: 'work_run_chat', id: workRunId}`. Preparation retains `{kind: 'work_chat', id: workId}`. Runtime turns still reference the immutable chat-message ID, which carries the Run association.
- `WorkDetailPage` passes its already-resolved selected Run ID into chat. `WorkChatPane` accepts optional `workRunId`; its keyed conversation resets history/draft/loading on selection changes. Read, send, and retry use that scope. Preparation confirmation (or a persisted started preparation observed by polling) switches subsequent conversation to the returned Run.
- Startup presentation has one translated status indicator, one next-action sentence, and one disabled/loading button while starting. Raw status and Definition-version readouts are removed. No CSS or other lane's files were changed.

## Schema and runtime findings

No migration is needed. Legacy NULL messages remain preparation history; this change does not guess which historical Run they belonged to. `0076_work_preparations.sql` already adds the nullable column. `0077_work_preparation_atomicity.sql` enforces `(work_run_id, tenant_id, workspace_id, work_id)` ownership against `work_runs`.

The manager's scope-collision finding is confirmed: `0074_runtime_session_closed_successors.sql` makes the active owner/scope/epoch tuple unique, and `PostgresRuntimeSessionStore.findByScope` uses that same tuple. `0056_runtime_model_replacement.sql` defines text `scope_kind` and `scope_id`, with no closed scope-kind check. The new scope therefore needs domain/store support, not SQL DDL. The PGlite test uses all real migrations and checks independent preparation/two-Run session lookups.

I inspected `src/entrypoints/mcp/product-work-mcp-tools.ts` and the MCP entrypoints: they do not call WorkChatService or expose these chat routes. Their existing Work start/continue tools remain unchanged. The exported product contract already re-exports `work-chat.ts`.

## Honest runtime limitation

This is a read-only conversational counterpart using the actual executor's published Worker version and instructions in a distinct session. It is **not** a binding to the live Task/TeamMemberRun execution session. It receives current Task/technical Run or Team status plus this Run's chat transcript. It has no execution transcript, result/artifact retrieval, TeamMessage delivery, steering, cancellation, approval, or resume authority. The prompt and UI identify the read-only limitation. No live-provider canary was run.

Queued replies for unbound Runs, missing executors, and legacy Agent-shaped root Tasks become failed messages (`work_run_executor_unavailable`); missing/mismatched Runs use `work_run_not_found`. Implementing live executor interaction requires a separate control-plane delivery/binding design. This limitation is not hidden behind a fake Lead entity or success claim.

## Red then green evidence

All full raw logs are local ignored artifacts in `.local/ia-a/`. Only relevant output is included here.

### Public API

Command: `pnpm test:unit src/infrastructure/postgres/postgres-work-chat-repository.test.ts src/entrypoints/api/routes/product-work.test.ts`

RED: new Run chat route returned `404` where `200` was expected. The first persistence attempt timed out during setup; that timeout is **not** counted as behavioral red evidence.

Initial route + executor GREEN:

```text
Test Files  2 passed (2)
     Tests  7 passed (7)
```

### Persistence

Command: `pnpm test:unit src/infrastructure/postgres/postgres-work-chat-repository.test.ts`

After correcting a fixture parameter-type error, the same test against the original repository produced the intended RED:

```text
AssertionError: expected null to be '<Run UUID>'
Test Files  1 failed (1)
     Tests  1 failed (1)
```

GREEN with the implementation (also includes worker tests):

```text
Test Files  2 passed (2)
     Tests  6 passed (6)
```

This checks both INSERTs, isolated history, scoped retries, idempotent replay, cross-bucket conflicts, foreign-owner reads, the real Run foreign key, and independent runtime-session scope lookups. PGlite does not prove real PostgreSQL concurrent locking behavior; no new claim about that behavior is made.

### Preparation-to-Run transition

Command: `pnpm test:unit src/infrastructure/postgres/postgres-work-chat-repository.test.ts`

RED: the promise for a new preparation message after Run creation resolved instead of rejecting with `WorkChatRunRequiredError`.

```text
Test Files  1 failed (1)
     Tests  1 failed (1)
```

GREEN (`pnpm test:unit src/infrastructure/postgres/postgres-work-chat-repository.test.ts src/entrypoints/api/routes/product-work.test.ts`):

```text
Test Files  2 passed (2)
     Tests  3 passed (3)
```

### Actual executor and runtime scope

Command: `pnpm test:unit src/application/work-chat/work-chat-worker.test.ts`

RED for both single-worker and collaboration definitions: expected `actual-worker`, received `definition-worker`.

```text
Test Files  1 failed (1)
     Tests  2 failed | 3 passed (5)
```

GREEN is included above. Tests also verify two distinct Run scopes, preservation of the preparation scope/intake, no intake updates from Run replies, and safe failure for missing Run identity.

### Browser facade

Command: `pnpm test:unit src/entrypoints/api/routes/browser-web.test.ts`

RED: GET returned `404` instead of `200`; POST and retry returned `404` instead of `202`.

```text
Test Files  1 failed (1)
     Tests  3 failed | 20 passed (23)
```

Final GREEN (`pnpm test:unit src/entrypoints/api/routes/product-work.test.ts src/entrypoints/api/routes/browser-web.test.ts src/application/work-chat/work-chat-worker.test.ts src/application/work-chat/work-chat-service.test.ts`):

```text
Test Files  4 passed (4)
     Tests  31 passed (31)
```

The route test additionally verifies missing authorization, invalid Run IDs, missing/foreign Run lookup, conflict normalization, and the unchanged preparation read endpoint.

### Chat pane, client, startup, and baseline red #4

The exact prescribed subset syntax, `pnpm test:web -- <path>`, ran the entire suite in this sandbox. Its initial baseline run gave:

```text
Test Files  2 failed | 49 passed (51)
     Tests  3 failed | 288 passed (291)
```

Only baseline failures #1–3 occurred in that run. Baseline #4 is intermittent, rather than consistently red here. I stopped two subsequent duplicate full-suite attempts and used the measured working subset syntax without the extra `--`:

`pnpm test:web apps/web/src/features/work/components/panes/work-chat-pane.browser.test.tsx apps/web/src/features/work/clients/work-client.test.ts`

Focused RED:

```text
client: expected /api/works/<Work>/runs/<Run>/chat, received /api/works/<Work>/chat
scroll: expected history text to contain 'Conversation message 34'
startup: expected a status indicator, received undefined
pane: expected chat(Work, Run), received chat(Work)
Test Files  2 failed (2)
     Tests  4 failed | 2 passed (6)
```

Focused GREEN:

```text
Test Files  2 passed (2)
     Tests  6 passed (6)
```

Diagnosis: `mockResolvedValueOnce` made each arrival disappear on the next one-second poll, when the mock reverted to its original history. This could occur before the 1,050 ms assertion under scheduling variation. Fixtures now retain the arrived history across polls. The assertions measure `scrollHeight`, `clientHeight`, and `scrollTop`: history really overflows, near-bottom arrival leaves at most two pixels below the reader, and a reader at the top keeps the exact position across arrival and a further poll. The production scroll algorithm was not replaced or masked with class-name assertions.

### Run copy and page selection

The Run empty-state test first failed because it still rendered the Definition-lead preparation copy. `pnpm test:web apps/web/src/features/work/components/panes/work-chat-pane.browser.test.tsx -t 'loads the selected Run'` reported `Tests 1 failed | 4 skipped (5)`. After the copy change, the pane/client focused run passed all 6 tests.

`pnpm test:web apps/web/src/features/work/pages/WorkDetailPage.test.tsx` first reported `Tests 1 failed | 1 passed (2)`: the historical Run selection rendered `data-run="preparation"`. The page now passes its resolved Run ID; final green evidence follows below.

The first full run after page wiring also exposed an outdated existing Work-detail browser fixture: it only served the preparation URL. That run had `Tests 4 failed | 292 passed (296)`, including the new composer test failure. The fixture now serves separate preparation/Run responses and explicitly checks that the selected Run URL is requested while preserving its real viewport/composer geometry assertions. This was a regression in this lane's test fixture, not an additional claimed baseline failure.

## Final verification

Final command: `pnpm test:web`

```text
Test Files  2 failed | 51 passed (53)
     Tests  3 failed | 293 passed (296)
```

The only failures are the brief's baseline #1–3:

1. `router.browser.test.tsx > serves the conversations list at /conversations instead of a route miss`
2. `router.browser.test.tsx > gives a first-time principal an onboarding empty state at /conversations`
3. `FilesPage.browser.test.tsx > scrolls the real Files list to its final file on desktop`

Baseline #4, all new chat/page tests, and the corrected Work-detail composer fixture pass. No new web failures remain.

- `pnpm web:check:types`: passed.
- `pnpm lint`: exit 1 from formatting only. Its backend `tsc -p tsconfig.json --noEmit` and web type check both passed after correcting the internal WorkModule capability type and the read-only runtime-store test dependency.
- The final lint formatter reports 18 files outside this diff: 17 tracked files unchanged from HEAD, plus the supplied untracked `BRIEF.md`. This includes forbidden `runs-pane.tsx`; the hard boundaries take precedence over unrelated formatting cleanup. The tracked warning files were checked against HEAD content hashes. No warning belongs to the outgoing diff.
- `pnpm exec prettier --check <all changed files and the new report/tests>`: passed (`All matched files use Prettier code style!`).
- `pnpm web:check:architecture`: passed (`single Vite frontend guard passed`).
- `pnpm check:architecture-replacement`: passed, with the same four existing baseline entries.
- `pnpm check:imports`: passed (`import-boundaries: ok`).
- `git diff --check` and hard-boundary path audit: passed.
- No `pnpm verify`, `pnpm test`, real PostgreSQL command, runtime/provider canary, Docker startup, or PR creation was performed. Vitest processes are allowed to exit/are stopped; no development infrastructure was started.

The full lint formatting blocker belongs to repository-wide cleanup/the manager, not this lane. The live executor-binding limitation above remains explicit product work.

## INTEGRATION REQUESTS

No blocked prop/helper request remains. The actual chat call site is `apps/web/src/features/work/pages/WorkDetailPage.tsx:79`, not `WorkPane.tsx`. This page is outside the brief's hard-boundary list. Its existing `runId` already follows the resolved selected Run, so this lane changes only the chat invocation to pass `workRunId={runId}`. The new page composition test first failed with `data-run="preparation"` for a selected historical Run.

When lane ia-b integrates its hierarchy changes, preserve the selected-Run propagation into `WorkChatPane`; do not replace it with an unconditional latest-Run ID. Omit the prop only before any Run exists. Work/Run hierarchy, compact header/tabs, and the directory remain lane ia-b's responsibility. No hard-boundary file was changed.
