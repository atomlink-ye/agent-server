---
status: completed
owner: agent/team-ergonomics
created_at: 2026-08-05
updated_at: 2026-08-05
authority: execution-plan
---

# Outcome

Make declared Teams easier to author without weakening AgentProject as the versioned boundary: keep the accepted non-empty roster/shared limits work, then prove a single-file three-member project has the same fingerprint and published artifacts as its fully explicit equivalent and launches through the existing entrypoint path.

## Context and authority

The Manager's 2026-08-05 brief authorized the forward-only `0027` constraint migration, roster relaxation, and shared Team limits. Phase B is accepted and checkpointed at `634d780`. The approved Phase A authority is `docs/superpowers/specs/2026-08-05-team-ergonomics-design.md`; it supersedes and prohibits the withdrawn inline-member HTTP design.

## Scope

- [x] Phase B: accept non-empty rosters at all four enforcement layers and add migration `0027`.
- [x] Phase B: make driver, evaluator, and PostgreSQL query enforcement read one shared limits object; raise `maxLeadTurns` above four.
- [x] Phase A: default only the approved boilerplate fields while keeping native validators strict for wrong explicit values.
- [x] Phase A: accept inline environment, agent, and team specs while preserving file-backed declarations.
- [x] Phase A: provide explicit built-in Team Lead/member tool-profile refs derived from the canonical role tool sets.
- [x] Phase A: normalize defaults and both authoring forms before canonicalization so equivalent projects have identical fingerprints, resource bytes, apply artifacts, and lock convergence.
- [x] Residual acceptance: preserve validation code, resource-qualified field path, and usable message while retaining generic handling for genuine filesystem faults.
- [x] Residual acceptance: default absent `toolProfiles` and `skills` sections to empty maps without synthesizing grants.

## Non-goals

- No new test suites, adapters, ports, retry/recovery/concurrency/performance work, generalized orchestration refactors, or changes to the deferred Team state-machine items named by the Manager.
- No inline Team construction at invocation time, new HTTP route, or new entrypoint launch mechanism. AgentProject remains the authoritative declared boundary.
- No native validator relaxation, migration, control-plane change, self-HTTP call, new adapter/port, synchronous terminal wait, push, or PR.

## Work breakdown

- [x] Complete explorer path map before code changes.
- [x] Implement and review Phase B.
- [x] Pass Phase B gate and report it before Phase A.
- [x] Read the revised Phase A design and complete a fresh loader/apply/entrypoint map.
- [x] Implement the smallest loader/authoring slice with a fresh fixer.
- [x] Have a fresh Oracle review fingerprint/artifact equivalence and fix any blocker.
- [x] Prove equivalence, apply, existing entrypoint launch, three-member projection, and real terminal outcome.
- [x] Run requested supporting checks and review the final diff.
- [x] Correct and review both Manager-reproduced authoring defects.

## Verification

- [x] `scripts/smoke/agent-teams-v2-main-flow.mjs` unchanged, two members, exits zero.
- [x] `make check` exits zero at the Phase B gate.
- [x] Short and explicit three-member projects produce identical project fingerprint, normalized resource bytes/fingerprints, and published lock artifact identities.
- [x] The short single-file project applies and `agentctl run` launches its default Team entrypoint against `opencode-go/glm-5.2` to a real terminal state with Lead plus three roster members.
- [x] Final `make check` and applicable existing integration/real-PostgreSQL checks exit zero.
- [x] Reconfirm fingerprint stability without canonicalization drift, inspect three requested broken-project CLI outputs, and rerun `make check` in that order. The Manager's exact `sha256:4738e84e980fa9a2306db93da7f5e113f4bc4136fdcbeb31fc4ad0e483f13115` fixture was not retained; its valid explicit fields traverse unchanged code, while a retained-compatible fixture was loaded by both `e995995` and final code with the same fingerprint.

## Documentation impact

- [x] Product/Feature status remains truthful for the bounded declaration ergonomics slice.
- [x] Component/Contract describe defaults, inline declarations, built-in profiles, and the unchanged invocation boundary where applicable.
- [x] ADR/Runbook impact is not applicable: the approved design authority records the boundary decision and no operator procedure changes.

## Decisions and discoveries

- Stage is `prove`; the Manager's brief plus revised design are the explicit Human Gate authority for the migration and declaration-contract changes.
- The earlier inline-member Phase A design is withdrawn permanently for this slice; invocation-time definitions are prohibited.
- Existing `agentctl run` already resolves `defaultEntrypoint` through the lock and invokes the published Team; it will be reused unchanged.
- Fingerprint equivalence is blocker-level for the Phase A native Agent, Environment, Team, and tool-profile authoring forms: their source locators/raw YAML/default omission must not survive into the normalized manifest, resource sources, source tuples, or digests used by the fingerprint funnel. Skill-directory and memory-seed locator semantics are unchanged.
- Non-blocking findings go to the deferred ledger rather than expanding scope.
- `maxLeadTurns` is 8: still bounded, with room for a three-member declaration's separate create/review cycles while `maxWorkItems` remains 4.
- Deferred hardening: for a large production `team_versions` table, consider `NOT VALID` plus later validation to reduce migration lock impact; this is not needed for the local MVE gate.

## Risks and recovery

`0027` is forward-only and was reviewed before real database execution. Phase A risks silently splitting project identity by authoring form or widening tools without declaration; equality evidence and Oracle review are required before the real run. Recovery is branch-local revert to checkpoint `634d780`; all apply/run verification uses disposable local state.

## Validation evidence

- `2026-08-05`: fixer ran `pnpm check:types`, the existing focused TeamVersion test (2 passed), durable-kernel plus agent-registry integration tests (67 passed, 12 skipped), and targeted Prettier checks.
- `2026-08-05`: Oracle reviewed the Phase B diff before real database execution. One unrelated migration tightening was corrected and re-reviewed; final recommendation was GO with no blockers.
- `2026-08-05`: `PASEO_MODEL=opencode-go/glm-5.2 make agent-teams-v2-smoke` ran the unchanged two-member script against real PostgreSQL/model and exited 0 with `RESULT_PASS`; durable cardinality was Lead plus two roster members, two Work items, two attempts, three TeamMessages, one direct message, four Lead turns, and terminal completion.
- `2026-08-05`: `make check` ran in the Node 24.18.0 Docker image and exited 0: types, formatting, docs, and Exec Plan checks passed.
- `2026-08-05`: fresh Phase A explorer mapped the loader, apply/lock, built-in-profile, and existing default-entrypoint paths before implementation. A fresh fixer implemented only the loader/authoring slice.
- `2026-08-05`: fresh Oracle review found three fingerprint-safety blockers (strict Team validation, file-backed metadata preservation, and omitted `memoryStores` normalization). The fixer corrected all three; Oracle re-reviewed and returned GO for equivalence/apply/model verification. The later Manager acceptance correction resolved the remaining authoring-error diagnostics rather than leaving them deferred.
- `2026-08-05`: a single-file three-member project and its explicit five-file equivalent produced fingerprint `sha256:7b57de7aa726ebd65192780a5305e815394725af2205bf1c8d17b633d0ac29a3`, identical normalized/rendered artifacts, and byte-identical apply lockfiles.
- `2026-08-05`: `agentctl run` used the single-file project's existing `defaultEntrypoint` against `opencode-go/glm-5.2`. Task `d4f6dca6-4ed0-4a7b-89e8-7f61bda629f2` completed; TeamRun `e8e120e8-e67f-4c46-ba10-c251fcb473dc` succeeded in phase `done` with one Lead plus three MemberRuns and three accepted Work items. A 150-second execution budget was proven insufficient by a captured `runtime_timed_out`; the successful disposable verification used 300 seconds without a product-code change.
- `2026-08-05`: final `make check` exited 0 in Node 24: types, formatting, 129-document validation, and Exec Plan checks passed.
- `2026-08-05`: `make test-integration` exited 0 with 12 files/141 tests passed and 7 files/36 tests skipped by their normal environment gates. `make test-real-pg` exited 0 with 6 files/74 tests passed and no skips.
- `2026-08-05`: final Oracle review found no Critical/Important product-code issue. Two documentation overstatements were corrected before archival.
- `2026-08-05`: Manager acceptance independently confirmed the single-file three-member flow and fingerprint equivalence, then reproduced two residual authoring defects: native validation errors collapsed to `filesystem_error`, and absent `toolProfiles`/`skills` maps remained mandatory. The plan was reopened for those slice-local corrections.
- `2026-08-05`: final code loaded equivalent inline/explicit environment fixtures as `sha256:160bd40081de88885dc366fef3493ff4c403fe1ef43a3356b19cbefecef7c0ac`; the same explicit-empty-map fixture produced that exact fingerprint under both committed `e995995` and final code. `project-canonicalization.ts` has no diff. The Manager's deleted `4738e84e...` fixture could not be literally rerun, so the evidence is recorded as a no-drift proof rather than a false observation of unavailable bytes.
- `2026-08-05`: requested failure probes returned `invalid_completion` at `$.spec.agents.lead.completion.command`, `invalid_project_reference` at `$.spec.teams.team.environmentVersionId`, and `yaml_invalid` at `$.spec.agents.lead`, with matching messages. A non-loader CLI error remained code-only; a missing manifest remained a qualified filesystem `missing_path` error.
- `2026-08-05`: after Oracle caught and the fixer corrected unsafe generic CLI message exposure plus collapsed early Team paths, Oracle re-reviewed both blockers and returned GO. Final `make check` then exited 0 in Node 24.

## Completion checklist

- [x] All scoped behavior and documentation agree.
- [x] Required real flow and supporting checks are recorded truthfully.
- [x] No secret, generated evidence, debug output, or task-owned out-of-scope edit remains.
- [x] Plan is complete and archived.

## Current blocker

None.

## Next exact command

Archive this completed plan, rerun `make check`, and commit the residual acceptance fixes locally without push or PR.

## Cleanup state

Phase B and the initial Phase A implementation are committed locally at `634d780` and `e995995`. All disposable residual verification fixtures and baseline source copies are removed. The unrelated untracked `src/adapters/in-memory/in-memory-runtime-adapter.ts` remains preserved unchanged and excluded.
