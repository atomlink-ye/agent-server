# Verification and completion

## Evidence ladder

Choose evidence proportional to the changed risk:

| Change                        | Minimum evidence                                       |
| ----------------------------- | ------------------------------------------------------ |
| Domain/config/helper          | Focused unit test plus types                           |
| HTTP contract                 | Contract test plus real-socket E2E when flow changes   |
| Adapter translation           | Component integration with fake SDK seam               |
| Paseo/process/model/readiness | Deterministic adapter tests plus live external smoke   |
| Durable state/concurrency     | Real database and concurrency/fault tests              |
| Tenant/credential/approval    | Adversarial isolation/security tests and Human Gate    |
| User-facing Agent behavior    | Versioned eval dataset plus ordinary correctness tests |

## Command truth

Record the exact command, date/environment when relevant, exit result, suites/assertions, and external provider/model for a smoke. If a command fails because a dependency or environment is absent, resolve it and rerun, or record the blocker and residual risk. Do not write “should pass” or infer a suite from a narrower command.

## Completion contract

A change is complete only if:

- code implements the accepted scope and preserves non-goals;
- Feature status is accurate and acceptance traces to tests/evidence;
- public and port contracts match code;
- focused and full deterministic checks ran;
- required external smoke/eval ran or an explicit blocker remains for the human;
- failures and residual risks are recorded honestly;
- behavior, architecture, operations, and agent instructions are synchronized;
- no raw secret/prompt/path/error exposure, debug code, unexplained TODO, skipped test, temporary config, runtime home, or generated evidence remains;
- the full diff contains only intended files;
- all plan work and completion items are checked;
- the plan is in `completed/` with `status: completed`.

## Automated harness

`check-docs` verifies required documents, local links, portable paths, and absence of private Drive URLs. `check-exec-plans` verifies lane/status agreement and forbids unchecked items in completed plans. These are necessary mechanical gates; they cannot judge whether a checkbox was checked truthfully.
