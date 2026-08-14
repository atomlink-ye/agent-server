# C4 production evidence ruling

## Current verdict

The full production journey is permanently gated as `E11_FULL_PRODUCT_JOURNEY` with status `BLOCKED_BY_PRODUCT_DEFECT`. It writes only `e11-full-product-journey-blocked.json` under the full evidence root (`C4_EVIDENCE_DIR`) and exits `2` (`MISSING`). It must never write a full `PASS` marker or a full artifact with status `PASS`.

The separate partial journey is `E11_STRUCTURAL_RELATIONSHIP_PARTIAL`. It has its own command, evidence root (`C4_E11_PARTIAL_EVIDENCE_DIR`), marker, status, exit code, and aggregate fields. A partial `PASS` can exist only in the partial artifact and cannot fill or overwrite the full status; every partial aggregate continues to report full status `BLOCKED_BY_PRODUCT_DEFECT`.

修好前任何让原内容断言变绿的做法都是掩盖产品缺陷

## C4 blocker-liveness arm (independent of E11)

The C-owned checker is `scripts/ci/check-product-feedback-projection-blocker.ts`.
It reads the current rework recorder's authoritative `manifest.json`,
`db/team_work_item_attempts.json`, and `api/work-run.json`, verifies the
sidecar provenance binding and full current `ProductWorkRunResponseSchema`
parse, then compares the unique non-empty DB feedback row with the same API
attempt by exact UTF-8 bytes.

| assertion | blocked_by | would_be_green_if | arm_that_proves_still_blocked | last_verified |
|---|---|---|---|---|
| Exactly one same-attempt DB feedback value is non-empty and the complete current ProductWorkRunResponseSchema parse reports that attempt as `feedback_summary=null`, `feedback_capture_status=redacted`; historical checker status `BLOCKER_STILL_PRESENT`, outer exit `1` | Product projection reads presence only and maps durable feedback to `null`/`redacted`; this is the B-owned projection defect | In `future_fresh_candidate` mode only, the same attempt's API summary is byte-for-byte equal to the durable DB feedback and its status is neither `not_present` nor `redacted`, under the accepted full current schema | Checked-in W-REC historical blocker arm (`historical_blocker_only`); independent of E11 full/partial, and neither arm can mutually prove the other | `recorded_at=2026-08-14T01:06:07.741Z`; `service_revision=0.1.0`; product revision `08c0d8351dbacab6e7e0eff5a686be11be3583db`; manifest SHA `07129cc7d1dc04a6235bf06a521c3391c5f92321ffc36446a54d086a72f5baa1`; API SHA `1e2f253af54e4f99054bc07cd14d624eac091b8be74398d39c98dbda43952933`; DB SHA `9d1b305133ff8e01415002fde7031a6fb539da86f446b54c452bee27beb3fa5f`; attempt `524401a1-fd03-4dfa-93c7-621452a5e71d`; `candidate_sha=null` |

The machine binding is `scripts/ci/product-feedback-projection-blocker-binding.json`.
It is a checked-in historical trust root: it binds this `rework-once` bundle's
exact manifest/API/DB hashes, recorded timestamp, fixed identities, and the
authoritative W-REC report/product revision `08c0d8351dbacab6e7e0eff5a686be11be3583db`.
It cannot be overridden with `--binding-file`, and historical mode never
accepts an unblock. The old/static replay bundle has no DB source and no
current binding, so it can only return `MISSING` (exit `2`).

`future_fresh_candidate` is currently a required command mode but is
fail-closed as `MISSING` (exit `2`) with
`reason=future_capture_attestation_not_implemented`. It does not inspect a
self-described manifest as freshness proof and cannot report either
`BLOCKER_STILL_PRESENT` or `UNBLOCKED_CANDIDATE`. Green reachability is pending
the accepted contract plus trusted direct-capture attestation/PLAN-D; an
external sidecar or old bundle cannot create that attestation.

The accepted capture enum is currently only `not_present|redacted`
(`src/contracts/product-projection/identity.ts`). Therefore
`UNBLOCKED_CANDIDATE` is intentionally unreachable under the current
contract. The eventual non-redacted status and its public field semantics are
a pending PLAN-D/Human Gate contract decision; this lane does not invent a
preview schema or modify product contracts.

The checker does not touch or reinterpret E11 full/partial status, does not
change B product projection code, and does not treat E11 as evidence for this
arm. Conversely, a future blocker-liveness result cannot establish E11.

The exact checker invocation and machine result are recorded below in the
verification section.

## Evidence layers and Manager interpretation

### HARD EVIDENCE

The domain feedback is accepted application input and first-class durable data, not provider raw material:

- Team MCP `requestChanges` accepts `feedback: z.string().min(1)` and forwards the exact input: `src/adapters/team-mcp/team-mcp-tools.ts:156-174` (schema at line 164).
- The application contract accepts trimmed, non-empty feedback up to 4096 characters: `src/contracts/teams.ts:20-28` (feedback at line 24).
- The command/repository path persists the value into `team_work_item_attempts.feedback`: `src/application/teams/team-command-service.ts:179-207`; `src/infrastructure/postgres/postgres-collaborative-team-repository.ts:1515-1525,1652-1664`.
- For attempt `524401a1-fd03-4dfa-93c7-621452a5e71d`, the durable DB snapshot contains a non-empty feedback value while the API snapshot has `feedback_summary: null` and `feedback_capture_status: "redacted"`: `reports/worker-c4-feedback-provenance.md:94-105`.
- The Product facts query selects only `(a.feedback IS NOT NULL) AS feedback_present`: `src/infrastructure/postgres/postgres-work-projection-facts-query.ts:136-150` (field mapping at `:194-207`). The facts source unconditionally maps summary to null and presence to redacted: `src/application/product-projection/work-projection-facts-source.ts:93-113`. Lineage records `presence_to_redaction_status` and `capture_to_null`: `src/contracts/product-projection/lineage-manifest.ts:492-506,527-553`.

### MANAGER INTERPRETATION/JUDGMENT — not reviewed by Owner

Manager interprets D10/D12 provider raw as raw completion, prompt, and credentials only, not domain-identified application feedback. Owner did not intervene in or review this interpretation, so it remains explicitly revisable Manager judgment rather than Owner authority. Under that interpretation, the corrected closed branch is `NEVER_PROJECTED`: the durable fact exists, no sanitizer or redaction rule participates, and the Product projection never carries the field. In this domain, `status: "redacted"` is a false statement derived from presence, not evidence that redaction occurred. The product gap is the facts query’s `IS NOT NULL`-only behavior plus the facts-source summary’s unconditional `null/presence -> redacted` mapping.

The Manager’s original causal enumeration was incomplete because its first three branches all presupposed that redaction occurred. `BRANCH_2_OVERBROAD_REDACTION` and its prescription—change a redaction rule, re-sanitize, or perform a zero-cost re-capture—do not apply here; re-capture would reproduce the same bytes. The correct future path is a B-owned Product projection change that carries the durable field. Manager C judges that this may require a Human Gate because content that was previously always `null` would begin crossing the system boundary; nobody has ruled that gate mandatory, and PLAN-D must decide whether it is required. C does not implement that change.

This is deferred as a PLAN-D input. It is not fixed in C, and no B-product fix is included.

## Exact recorder inputs and loader gate

Only the exact `api/work.json`, `api/work-run.json`, and `api/trace.json` documents from the two immutable sources were copied into the C4-owned subtree:

`scripts/e2e/support/recordings/c4/{parallel-success,rework-once}/api/`

The machine provenance ledger is `scripts/e2e/support/recordings/c4/provenance.json`. It records each source root, source manifest hash, source byte hash, and copy byte hash. All six copies were checked with `cmp` and their source/copy SHA-256 values match. No DB documents, manifest, wrapper envelope, migration, or hand-edited fixture was added.

`product-static-replay-upstream.ts` reads the three documents independently and first runs the complete accepted parsers on all of them: Work through the accepted `{ work: ... }` boundary (`GetWorkResponseSchema`), WorkRun through `ProductWorkRunResponseSchema`, and Trace through `ProductRunTraceResponseSchema`. A schema failure is `MISSING`. Only after all three full parses succeed does it verify the ledger byte hashes and derive WorkList/RunList. Hash mismatch is fail-closed `MISSING`.

## Full E11 behavior

The original E11 content assertions remain in `product-run-trace-walking-slice.ts`, including response identity, attempts, timing, geometry, feedback marker, activity, and the existing mutation assertions. The top-level full machine gate prevents those assertions from being used to produce a green result until the product defect is fixed. The blocked artifact contains the immutable machine name, blocked status, exit code `2`, defect facts, and an aggregate that explicitly keeps the partial status independent.

## Partial E11 behavior

Run the independent production browser journey with:

```sh
C4_CANDIDATE_SHA=<full-40-hex-sha> \
C4_E11_PARTIAL_EVIDENCE_DIR=<fresh-partial-evidence-dir> \
pnpm exec tsx scripts/e2e/product-run-trace-partial.ts
```

The partial path consumes only the rework-once scenario and proves:

- a feedback edge exists;
- the edge points to an existing attempt and its owning Work item;
- attempts and feedback counts are nonzero and stable across the accepted trace response;
- the feedback marker count is represented in the DOM;
- the related attempt has `feedback_capture_status: redacted`, with the corresponding redacted capture label in the DOM.

Evidence declares these `included_fields` explicitly. Feedback content is declared in `excluded_fields` as `blocked_by_product_defect`; it is not silently skipped. The partial script does not read, compare, or emit feedback text/content/summary/reason/payload.

Partial red arms use `C4_E11_PARTIAL_RED_ARM=edge|attempt|count|status|marker`. Each starts with a clean baseline, applies exactly one DOM mutation, reruns the same assertion, and writes `red-arms/e11-partial-<arm>.json` with status `FAIL` and exit `1` only when the targeted assertion newly fails without unrelated mismatches. Ineffective, zero-execution, incomplete, or pre-existing failures return `MISSING` (`2`) without red evidence.

## E10 and runtime boundary

E10 network semantics and the shared observer/cleanup behavior are unchanged. The fixture loader now gives E10 the accepted current-schema gate and exact copied bytes. No local browser, app, sandbox, provider, build, install, or full test run was performed. The root `tsconfig` is not evidence for these `scripts/e2e` entry points; targeted script compilation must be performed separately in the remote acceptance environment. Runtime E10/E11 evidence remains `MISSING/NOT_RUN` in this worker lane.

## Commits

- `4b958b6b28b1c9440afa0e1f3431c401e8ac0c16` — exact C4 recorder copies, provenance ledger, and accepted full-schema loader (8 files, 6693 insertions, 57 deletions).
- `acaca9e33272fb7153a4306d098b67cf3144c969` — full blocked gate and independent partial production journey (2 files, 348 insertions, 4 deletions).
- `242f49ed7595d36e3cb22fe06774c704accd073a` — isolate the partial edge red arm to a relation-only mutation (1 file, 5 insertions, 1 deletion).

Both commits retain ancestors `67c496c`, `6cc07f6`, and `16552e9`.

## Static validation

- `git diff --check`: passed for both C4 commits.
- `cmp`: passed for all six copied recorder documents.
- Provenance JSON parse: passed.
- Static scans: accepted-schema gate, provenance hash checks, immutable machine names, blocked full status, independent partial evidence root, five red arms, and partial excluded-field declaration present.
- Runtime/browser/build/install/provider/sandbox/full-test execution: skipped by dispatch constraints; no runtime PASS is claimed.

## Blocker-liveness verification

Command (current rework bundle, historical W-REC trust root):

```sh
(cd /Volumes/AgentsWorkspace/orgs/0xdtech/code/agent-server/.worktrees/mgr-frontend && C4_BLOCKER_MODE=historical_blocker_only C4_BLOCKER_BUNDLE_DIR=/Volumes/AgentsWorkspace/orgs/0xdtech/tasks/active/agent-server-implementation-20260722/rounds/2026-08-13-refactor-and-web-rebuild/artifacts/w-rec-rerecord-two-scenarios/rework-pull/recording-artifacts/wrec-rerecord-current/rework-once/20260814T010607741Z-4345ef71-2138-42e5-bc44-b03efdef65b1 pnpm exec tsx /Volumes/AgentsWorkspace/orgs/0xdtech/code/agent-server/.worktrees/mgr-frontend/scripts/ci/check-product-feedback-projection-blocker.ts)
```

Observed exit `1` and JSON status `BLOCKER_STILL_PRESENT`; the JSON recorded
`attempt_id=524401a1-fd03-4dfa-93c7-621452a5e71d`, `recorded_at`, service
revision, product revision `08c0d8351dbacab6e7e0eff5a686be11be3583db`,
`candidate_sha=null`, and all manifest/API/DB hashes. The required future-mode
command was also checked against this old bundle and returned `MISSING` exit
`2` (`future_capture_attestation_not_implemented`). Static fixture replay was
checked and returned `MISSING` exit `2` (`manifest_file_missing`); neither old
bundle nor self-described manifest can unblock or establish a current blocker.
