# Verification and completion

## Evidence ladder

Choose the cheapest honest evidence that touches the changed risk. During the current Prove stage, the representative real path, run as early as prerequisites allow, is the primary acceptance target:

| Change                        | Minimum evidence                                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Domain/config/helper          | Real main-flow evidence when reachable; supporting checks only when requested or needed                     |
| HTTP contract                 | Real main-flow E2E; focused contract evidence is required only by a changed public-contract Human Gate       |
| Adapter translation           | Observed adapter behavior; existing component checks are supporting evidence                                |
| Paseo/process/model/readiness | Real external behavior when the product path needs it; existing checks are supporting evidence              |
| Durable state/concurrency     | Real datastore/concurrency behavior when the product path needs it; existing checks are supporting evidence |
| Tenant/credential/approval    | Observed isolation/security behavior and Human Gate; existing checks are supporting evidence                |
| User-facing Agent behavior    | Real main-flow E2E; eval datasets and correctness tests only when explicitly requested                      |

## Command truth

Record the exact command, date/environment when relevant, exit result, suites/assertions, and external provider/model for a smoke. Run the real flow as early as prerequisites allow. Existing CI/checks may run and must be reported truthfully, but are supporting merge signals. Do not proactively author or expand tests, eval datasets, or fixtures without an explicit user request or Human Gate need. If a command fails because a dependency or environment is absent, resolve it and rerun, or record the blocker and residual risk. Do not write “should pass” or infer a suite from a narrower command.

## Completion contract

A Prove-stage slice is complete when:

- code implements the accepted scope and preserves non-goals;
- the acceptance claim traces to the observed real flow and code; existing tests are supporting signals;
- any public or port contract changed by the slice matches code and its required Human Gate is resolved;
- the primary real main-flow E2E ran successfully; for a documentation-only diff that changes no product behavior, record why it is not applicable;
- supporting checks that actually ran are reported, and any real runtime observation required by the slice or a Human Gate ran successfully;
- failures and residual risks are recorded honestly;
- documentation required to reproduce the accepted path is truthful; broader convergence may be deferred;
- no raw secret/prompt/path/error exposure, debug code, unexplained TODO, temporary config, runtime home, or generated evidence remains;
- the full diff contains only intended files;
- any plan used is truthful, and unfinished items are explicitly transferred rather than erased.

A slice whose real path is blocked is an honest blocked handoff, not a completed slice.

## Automated harness

`check-docs` verifies required documents, local links, portable paths, and absence of private Drive URLs. `check-exec-plans` verifies lane/status agreement and forbids unchecked items in completed plans. They are optional supporting checks in Prove unless the user requests them or the slice is explicitly completing/archiving the affected documentation. They cannot judge whether a checkbox was checked truthfully.
