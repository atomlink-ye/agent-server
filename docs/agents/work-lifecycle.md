# Work lifecycle

```mermaid
flowchart TD
    A[Understand outcome and authority] --> B[Inspect current code and boundary]
    B --> C[Bound one outcome and non-goals]
    C --> D{Blocking unknown?}
    D -->|Yes| P[Probe the real unknown]
    P --> E[Build the thinnest real path]
    D -->|No| E
    E --> F[Exercise the path early]
    F --> G{BLOCKER-NOW remains?}
    G -->|Yes| E
    G -->|No| H[Record durable follow-up where appropriate]
    H --> I[Stop at proof and hand off]
```

## Understand

Restate the desired observable result, current implementation, scope, non-goals, affected Feature/Component/Contract, and the cheapest credible verification. Inspect rather than assume.

## Implement

Prefer thin vertical slices and reversible edits. For product behavior, reach the real main path early. Do not add a generalized helper, test harness, or scenario script until a concrete repeated need exists.

When test setup is the obstacle, preserve the three-part model:

```text
Topology × Fixture × Test Case
```

Improve the shared environment lifecycle or typed fixtures instead of coupling all three into a new runner.

## Verify

Use the cheapest honest observation that touches the changed risk. Existing deterministic checks are useful supporting signals. Real external runtime paths are explicit opt-in and should only run when the changed boundary needs them.

A command that did not run is not a pass.

## Finish

Review the intended diff for scope, secrets, generated files, task-history residue, stale commands, and false status claims. Stop temporary infrastructure. Transfer non-blocking work to the appropriate issue/roadmap/decision context instead of growing the current slice or committing a handoff report to HEAD.
