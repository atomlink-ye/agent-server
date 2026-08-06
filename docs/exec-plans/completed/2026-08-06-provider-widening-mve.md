---
status: completed
owner: agent/provider-agnostic-runtime
authority: tasks/active/agent-server-implementation-20260722/BRIEF-phase1-2-provider-widening-mve.md
created_at: 2026-08-06
updated_at: 2026-08-06
---

# Provider widening MVE execution plan

## MVE contract

- Stage: Prove.
- Goal: widen managed-environment providers to `opencode | claude | codex`, make the process-global Paseo provider configurable, generalize the provider-named port methods, and prove one second provider through the real team smoke.
- Baseline: capture the existing team-smoke assertion values from unmodified `c9d7c54` in sandbox `3ac7261c-2c5d-4c99-87f2-fc0f36126a38` before source changes.
- Real path: team-smoke entry point -> managed-environment package validation -> run execution -> Paseo runtime/client -> configured provider -> observable smoke artifacts.
- No-gos: no provider registry, migration, per-run provider plumbing, multi-provider deployment, readiness rename, model-policy widening, runtime-cell-policy change, compatibility-shim cleanup, or new tests.
- Exit condition: `make ci`, `make paseo-smoke`, and the team smoke with `PASEO_PROVIDER=claude` or `codex` have fresh machine-written evidence; a baseline-reproducing environment failure is recorded as such.

## Safety and sequencing

- [x] Before every sandbox push or exec, confirm `sandbox-ctl status` reports sandbox `3ac7261c-2c5d-4c99-87f2-fc0f36126a38`.
- [x] Keep `src/application/runs/execute-run.ts` to one import plus one predicate swap (approximately two changed lines).
- [x] Keep `src/adapters/paseo/paseo-runtime-adapter.ts` under approximately fifteen changed lines; stop and report if either concurrent-file bound cannot be met.
- [x] Commit before every `sandbox-ctl push --mode git`; transfer committed history only.

## Execution checklist

- [x] Record worktree branch, HEAD, cleanliness, and sandbox binding.
- [x] Run and capture the unmodified `c9d7c54` team-smoke baseline in the named sandbox, including assertion values and durable artifact paths.
- [x] Step 1: add the exported provider tuple, provider type, type guard, typed field, and shared validation in `src/domain/environments/managed-environment-package.ts`; preserve the loader's `provider: 'opencode'` default.
- [x] Step 2: change only the import and duplicate provider gate in `src/application/runs/execute-run.ts` to use `isManagedEnvironmentProvider`.
- [x] Step 3: add `PASEO_PROVIDER` as the closed three-value enum with default `opencode`, surfaced as `config.paseo.provider`, in `src/shared/config.ts`.
- [x] Step 4: generalize `listOpenCodeModels` to `listModels(provider, cwd)` and `createOpenCodeAgent` to `createAgent({ provider, ... })` in `src/adapters/paseo/paseo-client-port.ts`; pin modes `opencode=build`, `claude=bypassPermissions`, `codex=full-access`; update only stale in-repo implementations/callers required to compile.
- [x] Step 5: add the provider option, pass it at both client calls, and replace the five runtime hardcodes in `src/adapters/paseo/paseo-runtime-adapter.ts`, within the concurrent-diff bound.
- [x] Step 6: pass `provider: config.paseo.provider` from `src/bootstrap.ts`.
- [x] Evaluate the optional declared/runtime provider mismatch rejection strictly under the brief's at-most-three-line/no-new-plumbing rule; otherwise document the limitation.
- [x] Step 7: update `.env.example`, the managed-environment API contract, and the runbook with `PASEO_PROVIDER`, the explicit non-opencode `PASEO_MODEL` pin, provider/mode behavior, and documented naming limitations.
- [x] Confirm operator-only model pin behavior remains intact and HTTP callers still cannot select arbitrary models.
- [x] Inspect the finished diff for scope, concurrent-file bounds, default-injection stability, and accidental changes.
- [x] Commit and push the implementation to the named sandbox after confirming its status.
- [x] Run `make ci` in the sandbox and capture machine-written output.
- [x] Run `make paseo-smoke` in the sandbox and capture machine-written output.
- [x] Run the existing team smoke with a second provider and `PASEO_MODEL=deepseek-v4-flash`, capturing manifest/assertion artifacts or the baseline-reproduced pre-harness environment result.
- [x] Parse one identical `provider: opencode` package at `c9d7c54` and literal `HEAD`, assert byte-identical fingerprints, and capture machine-written evidence.
- [x] Obtain an independent oracle review of the finished diff focused on breakage and spec compliance, without reopening design.
- [x] Route any blocker to the originating fixer, re-review, and rerun affected verification.

## Impact ledger

- Feature: impacted — managed-environment publication and team execution accept three closed provider values; one second provider must complete the real team path.
- Component: impacted — managed-environment domain validation, shared config, Paseo client port/runtime adapter, and bootstrap wiring.
- Contract: impacted — `ManagedEnvironmentPackage.spec.provider` widens from one literal to a closed three-literal union; the managed-environment API contract must be updated. `/health/ready` field `opencode_model` remains unchanged.
- ADR: no new ADR impact — process-global runtime selection and all other architectural decisions are already fixed by the authoritative brief; no new decision is introduced.
- Runbook: impacted — document `PASEO_PROVIDER`, required explicit `PASEO_MODEL` for non-opencode providers, process-global mismatch limitation if it cannot be rejected without plumbing, and the `free-only` naming inaccuracy.

## Deferred ledger

- Feature: per-run authoritative provider selection and multi-provider deployments.
- Hardening: provider mode/tool governance and later coordinated provider-named readiness/model-selector renames.
- Question: none; stop on any fact contradicting a decided premise rather than redesigning.

## Completion evidence

- Baseline evidence: sandbox `3ac7261c-2c5d-4c99-87f2-fc0f36126a38`, remote workspace `/home/daytona/workspace/provider-agnostic`, detached `c9d7c54d16c62c21488e3aeab02db4b4b1254a3f`; `PASEO_MODEL=deepseek-v4-flash make agent-teams-v2-smoke` exited `2` (`sandbox-ctl` chunk `49d739`) because `Cannot connect to the Docker daemon at unix:///run/agent-docker.sock`. The harness never started, so no assertion markers, manifest, stdout, or stderr artifact files were created.
- Committed/pushed implementation: `df8bb636cad8c4dd119b5798aa8a4eb3dec11914` on `agent/provider-agnostic-runtime`; committed-only git sync to sandbox `3ac7261c-2c5d-4c99-87f2-fc0f36126a38` succeeded.
- CI gate follow-up: formatting-only commit `d0f4ded5c4f6611abe5e858db3566656335efaf8` touches only the two Phase 0 probe scripts. On that commit TypeScript, Prettier, documentation, exec-plan checks, and unit tests (391/391) passed. Contract runs produced the documented sandbox-only c9d7c54 baseline timing result: variable 5-second timeouts in `tests/contract/runs.contract.test.ts` (observed 70/71 and 68/71), while an isolated test and standalone contract suite passed 71/71. Per `WORKFLOW-2026-08-06-remote-sandbox-manager-loop.md` section 6 this is recorded as environment evidence; GitHub Actions is authoritative and no sandbox-timeout fix was made.
- `make paseo-smoke`: passed at `d0f4ded` with exit `0`, marker `PASEO_OPENCODE_BASELINE_OK`, runtime-resolved provider `opencode`, model `opencode/deepseek-v4-flash-free`, and status `succeeded`.
- Provider-aware team-smoke proof harness: commit `6a81b2165c257ccd2dc41c0c4a900ef8f28aa37d` touches only `Makefile` and `scripts/smoke/agent-teams-v2-main-flow.mjs`; it preserves closed provider/model pins, asserts authoritative `runs.runtime` values for every terminal executed child, rejects missing/mismatched resolution, and writes `runtime-resolution.json`. Oracle re-review found no proof-logic blocker.
- Second-provider team smoke: `PASEO_PROVIDER=claude PASEO_MODEL=deepseek-v4-flash make agent-teams-v2-smoke` executed once at `6a81b21`. It failed closed before run creation with `Provider claude is not available`; persistent evidence is `/home/daytona/workspace/provider-agnostic/.local/agent-teams-v2-1786031616638-0ecb55b6/{manifest.json,stdout.ndjson,stderr.ndjson}` with `result: blocked`, no `RESULT_PASS`, and no `runtime-resolution.json`. The Docker runner image installs/configures only OpenCode and isolates provider HOME/config, so a live Claude execution requires an external runner-image/config prerequisite outside the two-file approved scope. No further widening was attempted.
- Fingerprint stability: `/Volumes/AgentsWorkspace/orgs/0xdtech/tasks/active/agent-server-implementation-20260722/evidence-fingerprint-stability/manifest.json`; each revision's own parser ran from separate archived checkouts for `c9d7c54` and literal `HEAD` resolved to `ec6f006be58ad95f6cbc4e7b99d3b55046ebaf57`; both exited `0` and produced `sha256:305eec9eddaddbfb3512dcbda657c5f289c75167a5bed303c4c3d640630df79d`, with `equality: true`, `validSha256: true`, and empty stderr.
- Independent review: oracle approved the provider-widening diff after the stale config expectation fix, and separately approved the final two-file runtime-proof harness after null-runtime, scripted-mode, and conditional-artifact blockers were corrected. Local verification included 391/391 unit, 71/71 contract, 141 integration passed with 36 configured skips, and typecheck passed.
