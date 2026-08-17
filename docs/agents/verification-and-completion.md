# Verification and completion

## Test taxonomy

Choose the smallest layer that expresses the risk truthfully.

| Layer          | Typical boundary                           | Infrastructure                                       |
| -------------- | ------------------------------------------ | ---------------------------------------------------- |
| Unit           | domain/helper/config/reducer               | none                                                 |
| Contract       | public HTTP/schema/error behavior          | in-process/fake                                      |
| Integration    | repositories/components/adapters           | PGlite by default; real PG when semantics require it |
| E2E            | complete deterministic process/socket path | explicit local topology as needed                    |
| External smoke | real Paseo/provider main flow              | explicit opt-in credentials/runtime                  |
| Eval           | Agent/model-quality behavior               | persistent dataset/evaluator                         |

Tests may be few in Prove, but their category must be truthful.

## Environment and fixtures

Infrastructure-backed tests should use `tests/support/environment` and the shared `config/local-environments.yaml` topology definitions. A focused test should not require an undocumented manual setup script.

Fixture setup is TypeScript-first. Serialized fixtures belong in Git only when a test consumes them as a stable protocol/example input.

Generated logs, screenshots, recordings, raw run captures, and diagnostic JSON go to ignored `.local/test-runs/<run-id>/`. CI may upload that directory as an artifact. Never copy one-run output into repository source as proof.

## Command truth

Report the exact command and actual outcome. If a dependency/environment is unavailable, resolve it, use an explicitly supported substitute, or report the blocker. Never write “should pass” as verification.

## Completion contract

A Prove-stage slice is complete when:

- code implements the accepted bounded outcome;
- the representative path or appropriate deterministic boundary has actually been exercised;
- public/durable contracts changed by the slice are updated and any Human Gate is resolved;
- failures and residual risks are reported honestly;
- no raw secret, prompt, private path, generated runtime output, debug residue, or task-history artifact remains in the intended diff;
- temporary infrastructure is cleaned up or explicitly handed off.

A blocked real path is an honest blocked handoff, not a completed slice.
