# C4 production evidence harness · local implementation ledger

Status: implemented and statically reviewed; production/browser evidence remains `MISSING/NOT_RUN`. The contract-valid WREC bundle closes its own E2 third-recorder gate only; it is not a C4 scenario source.

## Scope and ownership

This C4 slice owns only the schema-gated static replay upstream, the E10 production network harness, the E11 walking-slice harness, and this report. The untracked `artifacts/c2-trace-ui/` directory is C2-owned and was preserved untouched. C4-owned paths are clean; the worktree remains globally dirty only because of that pre-existing C2 artifact.

No `apps/web/**`, recorder fixture, contract, package/lock/config, or C1/C2/C3 report was edited.

## Implemented

- `scripts/e2e/support/product-static-replay-upstream.ts`
  - Reads only the two accepted positive recorder filenames.
  - Performs a hard full `ProductRunTraceResponseSchema.safeParse` of `recording_documents[0]` before using a recorder for any replay response.
  - Returns `MISSING` for the current `fa77ba9` recordings because both positive doc0 values fail the current target schema. No legacy recorder field is migrated or reshaped.
  - Derives `/api/v1/works` and `/api/v1/works/{id}/runs` only through the existing `projectWorkList` / `projectWorkRunList` helpers.
  - Serves Work, WorkRun, and trace responses only from the validated recording documents; it has no red-arm response mutation path.

- `scripts/e2e/product-run-trace-network.ts`
  - Starts the replay upstream, production app command, and a dynamically imported Chromium browser in the future remote acceptance environment.
  - Walks `/works` through the exact recorded Work title and href into Work Detail and counts only same-origin `/api/**` requests.
  - Allows exactly the five current `/api/works` route shapes plus an exact `chat_detail.path` extracted only from a successful response on one of those five routes after the corresponding current product-contract schema full parse; every other same-origin `/api/**` path is the forbidden complement, including an unknown response such as `/api/evil` that self-claims a chat path.
  - Requires works, runs, and trace hits, `allowed_hits >= 3`, and `forbidden_hits === 0`; zero required hits is `MISSING`, forbidden hits are `FAIL`.
  - `C4_RED_ARM=forbidden-request` injects one forbidden product request and records a non-zero red-arm result only when the real browser run reaches that assertion.

- `scripts/e2e/product-run-trace-walking-slice.ts`
  - Runs the parallel-success and rework-once scenarios independently.
  - Starts from the exact recorded Work title, requires exactly one matching link, verifies its recorded Work href, follows it, and verifies the navigated Work identity.
  - Parses and compares the Work list, Work response, WorkRun list, WorkRun response, and trace response with the current full schemas.
  - Compares recorded attempt timing/span facts, visible per-Attempt duration text and aria, proportional geometry styles, feedback marker count, MCP activity sequence/association facts, and rendered Events count.
  - Red arms are DOM-only after clean response comparison and a clean unmutated run of the same DOM assertion (including expected counts): rework switches back to Timeline and removes exactly one feedback marker; the selected scenario changes exactly one Attempt duration/geometry. The same assertion then must contain a newly introduced targeted mismatch and no unrelated mismatch. A pre-existing DOM mismatch, inapplicable arm, missing selector, ineffective mutation, or green assertion produces `MISSING` with no red evidence; fixture/upstream responses are never altered.

## Hard contract gate

The current two positive `fa77ba9` fixtures are not consumer-acceptance inputs: each `recording_documents[0]` fails the current full `ProductRunTraceResponseSchema`. Hash/count/provenance and selected-path checks cannot substitute for that parse. The contract-valid WREC directory
`rounds/2026-08-13-refactor-and-web-rebuild/artifacts/w-rec-third-recording/recording-artifacts/wrec-third/oi38-negative/20260813T213910949Z-c5f4a431-02ab-44e5-acd8-49d775db83ea`
does pass the current full schemas for its own `api/trace.json`, `api/work-run.json`, and `api/work.json`; that closes the WREC E2 third-recorder gate. It is intentionally not a C4 My Work/trace scenario source and does not globally unlock the old invalid `fa77ba9` recordings.

WREC is only parallel-shaped: it has two work items with one attempt each and activities, with no work item having more than one attempt, zero feedback edges/markers, and no applicable omit-feedback arm. Those facts cannot satisfy E11's required two-scenario `parallel-success` plus `rework-once` evidence. Full E11 therefore remains `MISSING/NOT_RUN` until separate current-schema-valid `parallel-success` and `rework-once` captures exist and every consumed target document passes the full current schema parse.

E10 could be a separately authorized and explicitly labeled network/schema preflight if the authority requests an adapted check; it is not current product-scenario acceptance. No adapter was added: Worker self-judgment is YAGNI because aliasing WREC into C4 would create false acceptance risk. Recovery requires either authority asking for that distinct preflight or valid scenario captures arriving. Thus the C4 scenario-source prerequisite is still open even though the WREC third-recorder gate is closed; C4 cannot claim a runtime PASS, and no runtime evidence directory or evidence file was created in this local phase.

## Future remote commands

Run only after a current-schema-valid recorder is available and the remote production environment can run the app/browser. Set `C4_EVIDENCE_DIR` to a fresh evidence directory and bind `C4_CANDIDATE_SHA` to the full candidate SHA.

Baseline E10:

```sh
C4_CANDIDATE_SHA=<full-40-hex-sha> C4_EVIDENCE_DIR=<fresh-evidence-dir> C4_REPLAY_SCENARIO=parallel-success pnpm exec tsx scripts/e2e/product-run-trace-network.ts
```

E10 red arm:

```sh
C4_CANDIDATE_SHA=<full-40-hex-sha> C4_EVIDENCE_DIR=<fresh-evidence-dir> C4_REPLAY_SCENARIO=parallel-success C4_RED_ARM=forbidden-request pnpm exec tsx scripts/e2e/product-run-trace-network.ts
```

Baseline E11:

```sh
C4_CANDIDATE_SHA=<full-40-hex-sha> C4_EVIDENCE_DIR=<fresh-evidence-dir> pnpm exec tsx scripts/e2e/product-run-trace-walking-slice.ts
```

E11 red arms:

```sh
C4_CANDIDATE_SHA=<full-40-hex-sha> C4_EVIDENCE_DIR=<fresh-evidence-dir> C4_REPLAY_SCENARIO=rework-once C4_REPLAY_MUTATION=omit-feedback pnpm exec tsx scripts/e2e/product-run-trace-walking-slice.ts
C4_CANDIDATE_SHA=<full-40-hex-sha> C4_EVIDENCE_DIR=<fresh-evidence-dir> C4_REPLAY_SCENARIO=parallel-success C4_REPLAY_MUTATION=constant-duration pnpm exec tsx scripts/e2e/product-run-trace-walking-slice.ts
```

Expected future artifact paths, created only after real execution:

- `<fresh-evidence-dir>/e10-network.json`
- `<fresh-evidence-dir>/red-arms/e10-forbidden-request.json`
- `<fresh-evidence-dir>/e11-walking-slice-parallel-success.json`
- `<fresh-evidence-dir>/e11-walking-slice-rework-once.json`
- `<fresh-evidence-dir>/red-arms/e11-<scenario>-<mutation>.json`

## Validation performed locally

- `git diff --check`: passed for the C4 commits.
- `rg` static scans: passed for schema-gate, endpoint classification, required hit counters, forbidden hit counters, and red-arm entry points.
- TypeScript source review: completed manually; no `pnpm`, install, build, dev server, browser, provider Run, sandbox, Docker, or full test command was run.
- E10 runtime/browser: `MISSING/NOT_RUN` by dispatch prohibition and current recorder contract gate.
- E11 runtime/browser: `MISSING/NOT_RUN` by dispatch prohibition and the missing separate current-schema-valid two-scenario captures; the WREC E2 closure does not change this.

## Commit units

- `2ea748840723a8b4dd2a6f2c2d97f802aa73b85e`: replay upstream — 1 file changed, 276 insertions(+).
- `06c66bf4f12ec0bcddb22b871af52b6f3ffe81ad`: E10 network harness — 1 file changed, 293 insertions(+).
- `81dfed20769af5020b7fede79ab25356e1529899`: E11 harness — 3 files changed, 272 insertions(+), 19 deletions(-).
- `820f6339dfb966e48cd1c90327838239a12cd6af`: initial ledger/report — 1 file changed, 83 insertions(+).
- `20a94e2c67b762a5db54cf1b7d3ee97c67f094e4`: first review fix — 2 files changed, 62 insertions(+), 16 deletions(-).
- `33fd4f2c82c8578d67fa4ce249360e42242a1c16`: Oracle review fixes — 4 files changed, 266 insertions(+), 94 deletions(-).
- `547f26863fa33f6dcb9233ec764595881e1bbf50`: full trace comparison microfix — 1 file changed, 1 insertion(+).
- `575a7b56436e26df46bace09d1eebef6b73d8825`: clean DOM red-arm baseline fix — 2 files changed, 48 insertions(+), 10 deletions(-).
- `faabd3eb04de17dcbfcedb8a6b3a66a59d2d9705`: final review fix — 2 files changed, 90 insertions(+), 30 deletions(-); latest C4 code integration before this report correction.
- This report-correction commit is intentionally omitted to avoid self-reference; the repo/round mirror is updated together.

## Shared observer and cleanup hardening

The C4 follow-up adds `scripts/e2e/support/page-observer.mjs`, which records
request/response/requestfinished/requestfailed lifecycle, exact method/path/
query allowlist decisions, response body parse outcomes, duplicate counts,
in-flight generations, bounded quiet-point sealing, and post-seal activity.
`owned-process-cleanup.mjs` records collector-unavailable, awaited TERM exit,
and TERM-ignoring residual outcomes fail-closed. E10 now uses the shared
observer and both E10/E11 use the owned cleanup function.

The C-box Node duals ran exit 0 with 10/10 tests, no skips/todos. The fixed E8
browser command ran in a restored isolated target with exit 0, one file and two
tests passed. These are harness evidence only; current C4 replay fixture/schema
gates remain `MISSING_EVIDENCE` and no runtime E10/E11 PASS is claimed.
