# Change summary

Describe the user or developer outcome and the boundary that changed.

## Contract and documentation impact

- [ ] Product/Feature documentation updated or confirmed not applicable.
- [ ] Component/Contract documentation updated or confirmed not applicable.
- [ ] ADR/Runbook updated or confirmed not applicable.
- [ ] Active Exec Plan is current and will be archived before completion.

## Verification

- [ ] Real main-flow E2E run as early as prerequisites allowed; record the exact flow and result. For documentation-only diffs that change no product behavior, mark not applicable and state why.
- [ ] Supporting checks actually run (existing CI is allowed but not required by default).
- [ ] `make paseo-smoke` when the Paseo/OpenCode boundary changed

Do not add or expand unit, contract, integration, deterministic E2E, eval-dataset, or test-fixture work unless the user explicitly requested it. Record actual commands and results in the Exec Plan. Never mark an unchecked item as implicitly complete. Preserve all security, tenant, credential, public API, migration, durable-state, and core-dependency Human Gates.
