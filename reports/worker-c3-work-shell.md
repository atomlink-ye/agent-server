# C3 Degraded My Work + Product Shell · Worker handoff

## Result

C3 is complete as a code candidate on branch `round/2026-08-13-frontend`.

The `/works` entry now reads as **My Work**, renders recorder-backed Work titles with response-derived detail links, and explains per item that Product status is currently unavailable. Loading, network error, empty, and populated-with-unavailable states are separate and user-readable. The existing C2 detail route remains the Historical Run Trace.

No Product status is derived from `runs[].status`, Attempt status, ordering, time, latest-run selection, or another heuristic. The list makes one `GET /api/works` read and does not issue runs/trace N+1 requests.

## Baseline and ancestry

- Baseline HEAD: `e8850f229e31dafa128e97d26c454c4e338c283a`
- Baseline worktree: clean
- C2 candidate plus later tests: baseline HEAD itself, `e8850f229e31dafa128e97d26c454c4e338c283a`
- C1 ancestor: `c57bb6e9ddb6d979253248c33f30c9224ef4dadf` — `merge-base --is-ancestor` exit 0
- Foundation ancestor: `2a50ec7918ca0beafc8571234b93838413089132` — `merge-base --is-ancestor` exit 0
- Foundation closeout in baseline history: merge `b2bfeb5`, containing `03d4581b`
- Final code candidate: `739b9abced32864882606bfaf8950d99300492cf`
- Evidence-ledger candidate before this report-only commit: `eb0c5dd2c1a42191fb7fc14f933dc9101264fe43`

## Local commits

1. `bc144c8bca9a427e48fd0a0b7504a7ce39e68793` — compose Work product shell
2. `dd8b1145723220b35fee7064f1f3763fa2d44e2a` — present recorded Work as My Work
3. `6de3beee544a492febcf688cf2d8814b1015c498` — distinguish loading/error/empty/unavailable states
4. `597386b8e5e6b7bfea962a677eff8d1e0ff0212b` — add recorder-backed My Work E8 test
5. `e3d4ba30afad0d396a14a4e27fcc6503c40016e6` — tighten state-language and visible-state coverage
6. `739b9abced32864882606bfaf8950d99300492cf` — normalize forbidden multi-word state semantics across spaces, hyphens, and underscores
7. `eb0c5dd2c1a42191fb7fc14f933dc9101264fe43` — record static evidence and explicit MISSING gates

## Design reference and Deferred

Read-only references:

- `/Volumes/AgentsWorkspace/orgs/atomlink-ye/code/agent-server-design/design/figma/00-foundations-shell/my-work/`
- `/Volumes/AgentsWorkspace/orgs/atomlink-ye/code/agent-server-design/design/figma/00-foundations-shell/my-work-empty-first-use/`
- `/Volumes/AgentsWorkspace/orgs/atomlink-ye/code/agent-server-design/design/figma/00-foundations-shell/my-work-return-state/`
- `/Volumes/AgentsWorkspace/orgs/atomlink-ye/code/agent-server-design/design/figma/00-foundations-shell/app-shell/`
- `/Volumes/AgentsWorkspace/orgs/atomlink-ye/code/agent-server-design/design/figma/foundations/`

The implementation adopts the shell structure, content hierarchy, restrained warm surfaces, card density, responsive sidebar, and spacing scale. It does not attempt pixel parity or a full token migration.

Deferred because reproducing them would require facts or capabilities not present in the accepted response: complete state lanes, Needs You / Problem / success / in-progress / waiting treatments, first-use creation CTA, return/unread markers, Resources/Inbox/Artifacts, and other product controls. This is the O-H9 stop condition: those regions cannot be made design-like without inventing data.

## Static review and independent oracle

- `git diff --check e8850f2..739b9ab`: exit 0
- Owned implementation/test diff: only `apps/web/components/work/work-shell.tsx`, `work-shell.css`, and `work-list.browser.test.tsx`
- Evidence: `artifacts/c3-work-shell/evidence-ledger.txt`
- Independent oracle declared E8/O-H3/O-H9 before review.
- First review found test-language gaps; the original fixer corrected them in `e3d4ba3` and `739b9ab`.
- Final narrow oracle verdict on `739b9ab`: **ACCEPT**, no remaining ownership-local BLOCKER-NOW.
- Oracle confirmed the runtime UI itself explains missing Product status rather than looking broken, preserves Historical Run Trace, has no list N+1, and remains recognizably from the referenced design family without fabricated facts.

## E8 and red-arm status

E8 is **MISSING**, not PASS.

The fixed command was not run:

`pnpm exec vitest --config vitest.web.config.ts --run apps/web/components/work/work-list.browser.test.tsx`

Reason: Manager C did not provide a remote heavy-work window, and the dispatch prohibits local dependency/browser execution. No Vitest, Playwright/browser, build, dev server, install, Docker, or Contabo work was run.

All required red arms are also **MISSING / NOT_RUN**:

- map `runs[].status` to Completed / 已完成
- remove the per-Work unavailable explanation
- add `/api/works/{id}/runs` N+1 enrichment
- remove the test, recorder fixture, or list node

The fixed direct-Vitest command also has a contract-shape conflict: code inside a test file cannot convert that same test file being absent into `MISSING=2`. C3 did not modify frozen `vitest.web.config.ts` or add an out-of-scope wrapper script. This remains an explicit MISSING, not a silent FAIL or inferred PASS.

## Diffstat through evidence commit

```
4 files changed, 776 insertions(+), 19 deletions(-)
```

The report-only commit adds this Markdown file after that diffstat.

## Explicitly not done

- No Product status heuristics, status branches, N+1 list enrichment, contract copy, BFF/route/contract changes, root cutover, legacy Chat movement, Definition/Artifacts/Inbox/completion controls, or global token migration.
- No provider Run, fixture fabrication, fixture alteration, Contabo operation, remote execution, install, build, browser, dev server, push, PR, or merge.
- No attempt to claim E8 or its red arms passed without an authorized execution window.

## Worker self-decisions

- Used the accepted C1 `projectWorkList` API and the two complete recorder fixtures instead of writing a second list contract.
- Preserved C2 detail composition and confined shell styling to feature-local `work-shell.css`.
- Classified the direct-Vitest missing-file exit-code incompatibility as MISSING and stayed within ownership instead of editing frozen config/scripts.
- Recorded unavailable design regions as Deferred rather than adding placeholder facts.

## E8 execution recovery (C3, candidate `02328517a0fe887464d0661d772a49ad9d88451b`)

This section supersedes the earlier “not run” execution note above. It records
the authorized C-box execution only; it is evidence, not a self-acceptance.

- Remote: C box `8174cc0c35a44a568688d8492fe15745`, workspace
  `/root/workspace/mgr-frontend`; final HEAD matched the candidate exactly.
- The Dockerfile `web-testing` target was attempted and retried. Both attempts
  hit the remote daemon's disabled BuildKit requirement for `RUN --mount`; this
  is INVALID/MISSING environment evidence, not a test result.
- The declared Playwright 1.62.1 only-shell Chromium install completed with
  exit 0. `package.json` stayed at SHA256
  `0430cec0c4892e90638a834274f0ea0db132b60e43dba0705b08571e526ed71d` and
  `pnpm-lock.yaml` stayed at SHA256
  `fc37e249d8e3bffa93c5861d673af1b927387f2d5900e62b5079eff6c1e4b9b6`;
  both post-install `cmp` checks returned 0.
- The fixed baseline command collected one browser test file and two tests;
  both passed (exit 0). Full output is in
  `artifacts/c3-work-shell/e8-02328517/04-baseline/`.
- Valid isolated red arms were a3 (runs `succeeded` mapped to `Completed`),
  b4 (unavailable disclosure removed), c2 (per-Work `/api/works/{id}/runs`
  N+1), and d2 (list `data-testid` changed); each exited 1 at its intended
  assertion. Their raw mutation/output evidence is under
  `artifacts/c3-work-shell/e8-02328517/08-arm-evidence/`.
- Missing-file arms e (test removed) and f (parallel recorder fixture removed)
  both produced the real fixed-command exit 1. They therefore remain
  `MISSING`, not PASS: the frozen direct Vitest command does not produce the
  required `MISSING=2` exit code for either condition.
- Final remote status retained only the pre-existing dependency-directory
  deletions plus the C3 remote evidence directory. The minimal image lacked
  `ps` and `pgrep`, so the final process probe is recorded honestly as
  unavailable; no C3 process was intentionally left running.

The complete execution index and raw artifact map are in
`artifacts/c3-work-shell/e8-02328517/execution-summary.md`.

## O-H16 C3/E8 classifier follow-up

The classifier implementation is C-owned and frozen-root/config untouched.
Classifier commit 1 is `a02b54af0a18c3eb9639806214509df62b335099` (parent
`01dce6d89baa89d21180159c5be8b0a5f1446f74`). It exports the closed two-kind
`classify({ kind, argv })`, captures and forwards child stdout/stderr, matches
only exact independent registered marker lines, and maps process status to the
specified 0/1/2 result without passthrough or child-exit-2 inference.

The C-box committed-only sync was blocked by pre-existing remote dirty paths.
For authorized execution, exact hash-matched committed blobs were copied into
isolated remote directory `/root/workspace/.c3-e8-classifier-a02b54a`; the
remote candidate remained `02328517a0fe887464d0661d772a49ad9d88451b`. Remote
classifier duals passed 7/7. The real test-file-absent and imported-fixture-
absent arms each structurally confirmed absence, ran the exact fixed Vitest
command, preserved raw output and raw exit 1, restored the input, and ended at
classifier process 2 with the exact kind marker. Full evidence is under
`artifacts/c3-work-shell/e8-classifier-a02b54a/`.

The prior real a3/b4/c2/d2 behavior arms remain the invariant evidence: each
exited 1 at its intended assertion and was not absence-classified. This report
does not self-sign ACCEPT.

## O-H16 classifier review-fix

Oracle-requested review fixes are in commit
`51c102f6806f06fb2458f7ae51ef25b4fa6446f8` (parent
`b4c8ec1838251bb9eb74a072f3fe2cc7cfdb87cd`). The classifier now preserves raw
Buffer forwarding, rejects all contradictory reserved namespace lines, enforces
strict CLI syntax, and emits absence evidence only after safe nonzero child
status plus a second structural absence check. Runner raw 0, spawn error,
null-status, signal, and restored-input cases do not emit markers and resolve
to process 1.

Updated C-box evidence is in
`artifacts/c3-work-shell/e8-classifier-51c102f/`: 10/10 updated duals passed,
and both real absence arms remained raw exit 1 / classifier exit 2 with restore
proof. Exact review-fix blobs were executed from isolated remote directory
because committed-only sync is still blocked by pre-existing remote dirty
paths; candidate HEAD stayed unchanged.

The historical range check
`git diff 01dce6d89baa89d21180159c5be8b0a5f1446f74..b4c8ec1838251bb9eb74a072f3fe2cc7cfdb87cd --check`
returns exit 2 due preserved raw ANSI evidence whitespace. Only source/tests
and report paths were checked separately; this report does not claim a full
range PASS or self-sign ACCEPT.

## O-H16 classifier framing follow-up

Framing-only fix commit:
`248d254db81d78bd813fdddff092572fcb8d38fa` (parent
`55f5ac360cf98ee4350d64950a24694ad79a1cb8`). When child stdout is nonempty
and unterminated, classifier and runner add one framing LF before their own
marker; child/raw bytes and raw evidence files remain unchanged.

The C-box rerun is under
`artifacts/c3-work-shell/e8-classifier-248d254/`: 11/11 duals passed, and both
canonical absence arms recorded raw exit 1 / classifier exit 2 with restore
proof and unchanged candidate HEAD. Exact source hashes are retained in the
remote final evidence.

The precise full historical range through the framing source parent checked was
`01dce6d89baa89d21180159c5be8b0a5f1446f74..248d254db81d78bd813fdddff092572fcb8d38fa`;
`git diff --check` returned exit 2 because preserved raw ANSI captures contain
trailing whitespace/newline findings across the older
`e8-classifier-a02b54a/`, `e8-classifier-51c102f/`, and follow-up raw evidence.
Only source/tests/runner/report paths were checked separately and returned
exit 0. Raw evidence is retained; no full-range PASS is claimed.

## O-H16 production-path framing dual follow-up

Test-wiring commit:
`6f1f0c39e093d6040c2596ab7ef0da5c99247927` (parent
`4278eb63864c19661a5689b836855ec0f68fe922`). The classifier framing dual now
spawns the production CLI and compares exact stdout bytes. The runner dual
invokes production `runAbsence` through its minimal spawn/absence/output seams,
then feeds the captured real output through the outer classifier; it does not
call framing helpers as a substitute.

C-box evidence is under
`artifacts/c3-work-shell/e8-classifier-6f1f0c3/`: 11/11 duals passed, and both
canonical absence arms remained raw 1 / classifier 2 with restoration and
candidate-hash proof. The exact source hashes are bound in each remote
manifest.

After the evidence commit, the canonical symbolic command
`git diff --check 01dce6d89baa89d21180159c5be8b0a5f1446f74..HEAD` is recorded as
exit 2 because preserved raw ANSI captures in `e8-classifier-a02b54a/`,
`e8-classifier-51c102f/`, `e8-classifier-248d254/`, and
`e8-classifier-6f1f0c3/` contain whitespace
findings. Scoped source/tests/runner/report checks are exit 0; raw evidence is
retained and no full-range PASS is claimed.

## C3/E8 CLI reachability follow-up

Reachability test commit `1dbdc999981e4ab4bbeb875bb2a49062918bd676` (parent
`96cbb8bd94020b072f02b0f752859ec010eef7f8`) adds production-CLI subprocess
coverage for zero arguments, an unknown kind with a non-executed sentinel, and
a known kind with a guaranteed ENOENT command. The C-box run passed 12/12 Node
duals. Each reachability arm returned CLI exit 2, empty stderr, and its exact
registered invalid/missing marker; child status is N/A for usage and unknown
kind, and N/A after ENOENT spawn failure. Per-arm argv, exact stdout hex,
stderr hex, exit, and child/raw-status facts are under
`artifacts/c3-work-shell/e8-reachability-1dbdc99/reachability/`.

The reachability harness uses only static Node builtin imports and
candidate-owned local modules. It has no dynamic import, optional parser/API,
or fabricated fixture/module-missing arm. A candidate-required local-module
linking failure remains raw process 1 with no marker and FAIL classification,
never MISSING.

The canonical symbolic range check
`git diff --check 01dce6d89baa89d21180159c5be8b0a5f1446f74..HEAD` remains exit 2
because preserved raw ANSI captures in the earlier
`e8-classifier-a02b54a/`, `e8-classifier-51c102f/`,
`e8-classifier-248d254/`, and `e8-classifier-6f1f0c3/` contain whitespace
findings. The `e8-reachability-1dbdc99/` evidence does not trigger the check.
Scoped source/tests/runner/report checks are exit 0. Raw evidence is retained
and no full-range PASS is claimed.

## C3/E8 bounded request observation and C4 harness follow-up

E8 implementation commits are `c9eb90f`, `e4a61c4`, and `aae8479`. The
populated browser assertion now wraps the production `fetch` path in a
C-owned ledger that records generation, method, full URL/path/query, start and
settle lifecycle, in-flight counts, rejection, seal state, and post-seal
activity. It waits for all known work to settle, two quiet event-loop turns,
and a bounded post-seal guard. Pending, collector errors, timeout, and late
activity are incomplete evidence, not absence. The populated response is a
poisoned closed shape derived from the C1 projection: only `id` and `title`
can be read; status/runs/latest/attempt/order/time/product-state reads throw.

The C4 implementation commits are `82edbe9`, `6560a85`, and delayed-activity
dual follow-up `c243e0a`. The shared
`scripts/e2e/support/page-observer.mjs` owns request, response,
requestfinished, and requestfailed lifecycle records, exact method/path/query
allowlist matching, body acquisition/parse outcomes, sealed response counts,
post-seal activity, and fail-closed verdicts. The owned-process cleanup helper
records unavailable collector, awaited SIGTERM exit, and TERM-ignoring residual
states; it never claims no residual when collection is unavailable.

C-box Node evidence is under
`artifacts/c3-work-shell/e8-c4-harness-6560a85/node/`: exit 0, 10/10 tests,
0 skip, 0 todo. The authorized fixed browser command was run in a restored
isolated target on C box and is under
`artifacts/c3-work-shell/e8-c4-harness-6560a85/browser/`: exit 0, one file,
two tests passed. Remote committed-only sync was blocked by the pre-existing
remote dirty state; the remote candidate remained `02328517a0fe887464d0661d772a49ad9d88451b`
and was restored after the isolated browser run.

The complete claim matrix, including explicit incomplete arms and the
three-value verdict vocabulary, is
`reports/worker-c3-absence-observation-matrix.md`. Existing C4 recorder/schema
prerequisites still prevent a runtime E10/E11 acceptance claim; those rows are
`MISSING_EVIDENCE`, not silent absence.

## Zero-execution audit follow-up

`3484079` adds a closed ten-kind C3/C4 zero-execution guard. Its declared
minimums are source-owned (`e8-browser=2`, `c3-classifier=12`, both E11
scenarios=2, and the relevant controls/arms at least 1); observed zero is
always a distinct `c3_c4_zero_execution:kind=...:expected_min_count=...`
marker with outer process 2. The production CLI zero duals ran all ten kinds
on C box: each observed count was 0, exact marker was emitted, and exit was 2;
the guard dual itself was exit 0 with four cases and no skips/todos. Business
empty-state cardinality remains separate from acceptance execution counts.

The matrix now appends `expected_min_count`, `observed_count_source`,
`zero_trigger`, `zero_exit`, `canonical_zero_arm`, and final `verdict` to every
C-owned claim, including the four E8 behavior-arm rows, classifier/runner,
request ledger, E10/E11, response, DOM, and cleanup probes. Zero runtime C4
scenario/response/DOM/cleanup evidence remains `MISSING_EVIDENCE`; it is not
reported as a pass.

## Oracle proof-chain follow-up

The C3 browser wrapper follow-up is `5ea797b`, `07363f0`, `359e07a`, and
`0b1f68c`. It now gives each mutation an isolated `VITEST_CACHE_DIR`, bounds
the child process, parses failed Vitest summaries, and maps a non-zero child
with no parseable summary to an explicit browser-zero marker and process 2.
The wrapper baseline on C box was raw 0 / wrapper 0 with one file, two tests,
zero skipped and zero todo. The fixed command was the production path, not a
summary-only helper.

The C-box production WorkShell mutation evidence is under
`artifacts/c3-work-shell/e8-production-0b1f68c/`. The four arms were run from
the same restored source hash (`d975b44b30c2785dbb93729d5fa7c2f482b8c4b9f99db7bc80750193b7978287`):

- `late-runs`: raw 1 / wrapper 1; the failed summary was parsed as one failed
  and one passed test, proving the sealed request assertion executed.
- `never-settle`: raw 1 / wrapper 2 with
  `c3_e8_browser_zero_execution:reason=summary-unparseable`; the production
  fetch stayed pending and the bounded runner recorded incomplete evidence.
- `status-read`: raw 1 / wrapper 1; the poison Proxy exception caused the
  populated assertion to fail, with one failed and one passed test.
- `container-identity`: raw 1 / wrapper 1; the production list identity
  mutation caused the exact container assertion to fail.

Each arm has mutation output, candidate-before/after hashes, raw stdout/stderr,
raw child exit, wrapper exit, capture exit, and an EXIT restoration trap. The
remote candidate remained `02328517a0fe887464d0661d772a49ad9d88451b`; after the
arms its WorkShell hash again matched the before hash. The C-box Node harness
run for the wrapper, zero guard, page observer, and cleanup duals was raw exit
0 with 14 tests, 0 skip, and 0 todo.

The original projection poison now guards `get`, `has`, own-key enumeration,
and property descriptors while allowing only `id` and `title`; the status red
arm therefore traverses the actual WorkShell data path. The matrix updates
the three production red arms and status-read control to
`COMPLETE_AND_PROVEN_ABSENT`; C4 runtime rows remain
`MISSING_EVIDENCE` because the current recorder fixture/schema gate still
prevents a valid E10/E11 browser acceptance run.

The shared C4 observer is now wired into both production E10 and E11 flows.
E10 derives a closed method/path/query tuple set from the accepted recording;
E11 replaces its response/pending Map with the observer's lifecycle, body,
seal, exact response-count, and fail-closed verdict. No C4 runtime PASS is
claimed without valid scenario fixtures.
