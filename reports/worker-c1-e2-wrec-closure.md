# C1/E2 W-REC evidence handoff

This report records the runtime artifacts produced by Manager C for candidate
`2623bc50490ff005472f763d3948d2753892b4f5`. It is an evidence handoff, not an
E2 acceptance signature; final acceptance belongs to the independent reviewer.

## Raw evidence

The pulled, self-contained runtime bundle is at:

`/Volumes/AgentsWorkspace/orgs/0xdtech/tasks/active/agent-server-implementation-20260722/rounds/2026-08-13-refactor-and-web-rebuild/artifacts/mgr-c-e2-pull-2623bc5/`

Its `exit-code.txt` records the real harness exit as `0`. The machine-readable
`evidence/summary-pass.json` binds the candidate SHA and points to four case
records containing the exact command, environment, stdout, stderr, expected and
actual exits, byte tables, and post-case restore checks.

| Case | Expected | Actual | Stage assertion | Source/fixture restore gate |
| --- | ---: | ---: | --- | --- |
| baseline | 0 | 0 | true | PASS |
| hash mismatch | 1 | 1 | true | PASS |
| missing file | 2 | 2 | true | PASS |
| schema-invalid flat target | 1 | 1 | true | PASS |

The baseline raw stdout reports all three current accepted schema parses as
`PASS`, `recorder_count=3`, `negative_control_count=1`,
`old_oi38_summary_counted_as_recorder=false`, `third_recorder_slot=PASS`, and
`product_recording_provenance_exit=0`. It also reports a 33-file product-boundary
scan with no hits. These are runtime outputs, not a worker-authored acceptance
claim.

## Byte provenance and transfer mirrors

The original W-REC source is the exact local task path:

`/Volumes/AgentsWorkspace/orgs/0xdtech/tasks/active/agent-server-implementation-20260722/rounds/2026-08-13-refactor-and-web-rebuild/artifacts/w-rec-third-recording/recording-artifacts/wrec-third/oi38-negative/20260813T213910949Z-c5f4a431-02ab-44e5-acd8-49d775db83ea`

The original-source hashes were computed at that path. The remote
`/root/e2-inputs/wrec-source-transfer` directory was only a byte-preserving
transport mirror used to make that source available to the remote checker; it
is not the original source. Each case JSON contains the 12-row
`byte_binding_rows` table, which binds expected SHA-256, transfer-mirror SHA-256,
committed-fixture SHA-256, and isolated-input SHA-256. For the baseline, the
original-source expected hashes, transfer mirror, and committed fixture agree
for all 12 files. Every case then rechecks the immutable transfer mirror and
committed fixture after its isolated mutation.

The separately transported legacy-source mirror served only the checker's
legacy parallel/rework recorder and old oi38-negative provenance checks. It is
likewise a transport mirror, not an original source. The old oi38-negative
summary remains an independent negative control and is not counted as a
recorder. The W-REC bundle remains outside product projection inputs.

## Remote execution preparation

Before dependency installation, Manager C removed only the two O-H16
workspace-local symlinks `node_modules` and `apps/web/node_modules`. Manager C
then ran the lockfile-preserving frozen install. The candidate source,
checker/harness, fixture, and package/lock files were not changed by this
preparation. Runtime execution used the repository's installed `tsx` and current
accepted Zod schemas.

Earlier failed attempts remain retained in the round artifacts as attempt
history. They are not substituted for the final bundle above.

## Review state

Implementation and evidence production are complete. Independent final review
is in progress; this worker does not sign its own E2 result.
