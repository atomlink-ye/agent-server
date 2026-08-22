# Release gates

## Current Prove-stage gate

The repository remains in Prove / MVE-first product implementation until explicitly changed. The default completion bar is one bounded representative path or the smallest truthful deterministic boundary, no `BLOCKER-NOW`, no unresolved required Human Gate, and honest residual-risk reporting.

Opening a PR does not automatically turn a slice into a hardening project. Run the checks that match the changed risk and report exactly what ran.

## Pull-request hygiene

A Prove-stage change should contain:

- one coherent outcome;
- no secrets, runtime homes, generated test/run output, or task-history artifacts;
- semantic durable names rather than temporary phase/lane/worker identifiers;
- supporting checks that actually ran;
- ADR/Human Gate when changing public contract, core dependency, security/tenant/credential boundary, migration/durable state, or destructive behavior.

Generated run diagnostics stay in `.local/test-runs/` or CI artifacts, not in HEAD.

## Deterministic repository gate

`pnpm run verify` is the main deterministic aggregate. `pnpm test:pg` is a separate datastore-specific lane. Browser and live-provider paths are explicit when their boundary is in scope.

External runtime smokes are never required merely because they exist; provider availability and credentials are external conditions.

## Stronger release/hardening gates

When a release or hardening task explicitly requires them, add the relevant real boundaries: datastore concurrency/recovery, tenant/credential isolation, execution-plane failure/reconciliation, cancellation/retry behavior, browser product flows, migration recovery, and real provider compatibility.

Those stronger gates are product-risk requirements, not permanent justification for task-specific mutation runners, evidence directories, or a second CI harness.
