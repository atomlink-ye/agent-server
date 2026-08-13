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

