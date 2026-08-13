# C4 production evidence harness · local implementation ledger

Status: implemented and statically reviewed; production/browser evidence is `MISSING/NOT_RUN`.

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
  - Allows exactly the five current `/api/works` route shapes plus an exact `chat_detail.path` observed in a real response; every other same-origin `/api/**` path is the forbidden complement.
  - Requires works, runs, and trace hits, `allowed_hits >= 3`, and `forbidden_hits === 0`; zero required hits is `MISSING`, forbidden hits are `FAIL`.
  - `C4_RED_ARM=forbidden-request` injects one forbidden product request and records a non-zero red-arm result only when the real browser run reaches that assertion.

- `scripts/e2e/product-run-trace-walking-slice.ts`
  - Runs the parallel-success and rework-once scenarios independently.
  - Starts from the exact recorded Work title, requires exactly one matching link, verifies its recorded Work href, follows it, and verifies the navigated Work identity.
  - Parses and compares the Work list, Work response, WorkRun list, WorkRun response, and trace response with the current full schemas.
  - Compares recorded attempt timing/span facts, visible per-Attempt duration text and aria, proportional geometry styles, feedback marker count, MCP activity sequence/association facts, and rendered Events count.
  - Red arms are DOM-only after clean response comparison: rework removes exactly one feedback marker; the selected scenario changes exactly one Attempt duration/geometry. The same baseline DOM assertion function then must detect the targeted mismatch. Inapplicable arms, missing selectors, or green assertions produce `MISSING` with no red evidence; fixture/upstream responses are never altered.

## Hard contract gate

The current two positive fixtures are not consumer-acceptance inputs: `recording_documents[0]` fails the current full `ProductRunTraceResponseSchema`. Hash/count/provenance and selected-path checks cannot substitute for that parse. C4 therefore cannot claim a runtime PASS, and no runtime evidence directory or evidence file was created in this local phase.

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
- E11 runtime/browser: `MISSING/NOT_RUN` by dispatch prohibition and current recorder contract gate.

## Commit units

- `2ea748840723a8b4dd2a6f2c2d97f802aa73b85e`: replay upstream, 1 file, 276 insertions.
- `06c66bf4f12ec0bcddb22b871af52b6f3ffe81ad`: E10 network harness, 1 file, 293 insertions.
- `81dfed20769af5020b7fede79ab25356e1529899`: E11 harness, 3 files, 272 insertions/19 deletions.
- `820f6339dfb966e48cd1c90327838239a12cd6af`: initial ledger/report, 1 file, 83 insertions.
- The final review-fix commit SHA and diffstat are reported in the worker handoff so this report does not self-reference its own commit.
