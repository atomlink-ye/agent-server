---
name: agent-server-find-simplifications
version: 1.0.0
triggers:
  - simplify repository
  - code gardening
  - remove legacy code
inputs:
  - repository scope
outputs:
  - evidence-backed delete/fold candidates
permissions:
  - read repository
  - edit when explicitly requested
validation:
  - every proposal has consumer evidence
---

# Agent Server Simplification Audit

Prefer deletion and one authoritative representation over another abstraction layer.

## Candidate bar

Strong candidates include:

- a production export/route/config key/helper with no production consumer;
- tests/docs as the only consumer of behavior that is not load-bearing;
- a legacy/deprecated/compatibility surface with no named production owner;
- two durable/transient structures storing the same fact;
- a public service method with one private caller that can be a closure/constructor dependency;
- a wrapper or registry that relocates complexity without deleting it;
- a test-only composition seam present in production APIs;
- phase/lane-specific source artifacts whose phase is not a product concept.

## Prove each candidate

Search the exact symbol, wire string, config key and route. Classify every consumer as:

```text
production
test/doc only
ambiguous dynamic
none
```

Read the call site before deciding. Do not delete a boundary protected by current public API, durable data, security/credential semantics or an active architecture decision merely because it looks complex.

## Compatibility rule

A retained compatibility surface requires a record containing production consumers, owner, reason and removal condition. Otherwise remove code, tests and docs together.

## Lifecycle simplification

For async code, draw the ownership graph. Multiple readiness promises, sentinels, cancellation flags or disposer stacks that represent one settlement fact should become one lifecycle controller. Preserve separate state only for a distinct owner/commit/rollback/quiescence point.

## Output

Return a small set of high-confidence candidates with exact files/symbols and net deletion/ownership benefit. For an explicitly requested full cleanup, implement every accepted candidate in scope and re-run exact-symbol searches afterward.
