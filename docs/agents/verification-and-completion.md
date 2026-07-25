# Verification and completion

## Evidence ladder

Choose evidence proportional to the changed risk. During the current product implementation stage, the smallest complete user-visible/main-flow real E2E, run as early as prerequisites allow, is the primary acceptance target:

| Change                        | Minimum evidence                                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Domain/config/helper          | Real main-flow evidence when reachable; supporting checks only when requested or needed                     |
| HTTP contract                 | Real main-flow E2E; contract checks are supporting evidence                                                 |
| Adapter translation           | Observed adapter behavior; existing component checks are supporting evidence                                |
| Paseo/process/model/readiness | Real external behavior when the product path needs it; existing checks are supporting evidence              |
| Durable state/concurrency     | Real datastore/concurrency behavior when the product path needs it; existing checks are supporting evidence |
| Tenant/credential/approval    | Observed isolation/security behavior and Human Gate; existing checks are supporting evidence                |
| User-facing Agent behavior    | Real main-flow E2E; eval datasets and correctness tests only when explicitly requested                      |

## Command truth

Record the exact command, date/environment when relevant, exit result, suites/assertions, and external provider/model for a smoke. Run the real flow as early as prerequisites allow. Existing CI/checks may run and must be reported truthfully, but are supporting merge signals. Do not proactively author or expand tests, eval datasets, or fixtures without an explicit user request. If a command fails because a dependency or environment is absent, resolve it and rerun, or record the blocker and residual risk. Do not write “should pass” or infer a suite from a narrower command.

## Completion contract

A change is complete only if:

- code implements the accepted scope and preserves non-goals;
- Feature status is accurate and acceptance traces to the observed real flow and code; existing tests/evidence are supporting signals;
- public and port contracts match code;
- the primary real main-flow E2E ran or an explicit blocker remains for the human; for a documentation-only diff that changes no product behavior, record why the E2E is not applicable;
- supporting checks that actually ran are reported, and required external smoke ran when product runtime behavior changed or its blocker is recorded;
- failures and residual risks are recorded honestly;
- behavior, architecture, operations, and agent instructions are synchronized;
- no raw secret/prompt/path/error exposure, debug code, unexplained TODO, temporary config, runtime home, or generated evidence remains;
- the full diff contains only intended files;
- all plan work and completion items are checked;
- the plan is in `completed/` with `status: completed`.

## Automated harness

`check-docs` verifies required documents, local links, portable paths, and absence of private Drive URLs. `check-exec-plans` verifies lane/status agreement and forbids unchecked items in completed plans. These are necessary mechanical gates; they cannot judge whether a checkbox was checked truthfully.
