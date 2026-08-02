# Agentic Team Chat MVE evidence

- Date: 2026-08-02
- Model: `opencode-go/deepseek-v4-flash`
- TeamVersion: `4938e173-7f1b-4075-918c-84d6ba31883d`
- Root Task: `3dfb776a-3c5f-443f-920b-b95f17cdaedd`
- TeamRun: `0d4b4a75-5c9d-4093-92d9-559c4d8654e0`

## Backend

- Team succeeded.
- There were 4 Lead turns, 1 WorkItem, 2 immutable attempts, and 1 rework attempt.
- All attempts completed and were linked to TeamMemberRuns.
- Final text presence was proven.
- Agent Sessions: analyst `4b472a29-9676-4b77-ac7c-4ed652c9982a`, lead `50dd05e9-79f6-4fb2-8215-55bd9202712f`, verifier `2123601e-7db4-4791-9d21-693cb5d69dae`.
- The fixed Verifier was unused in the observed run; Web status is `Queued` with zero fabricated results.

## BFF and browser

- The BFF completed with 3 sessions and 6 historical event replays.
- Stepwise Playwright gates passed for Project, Lead, member/rework, refresh, mobile, storage, and network.
- The overall persistent `playwright-shared` result passed: Lead turns 4, member attempts 2, feedback visible, refresh restored, desktop/mobile overflow false, drawer closed, credential storage false, direct `/api/v1` false, event replays 6, and console errors 0.

## Supporting checks

The following passed after Project Lab removal:

```text
make check
make web-check-types
make web-build
```

The report SHA was not captured in this retained run. It is an evidence
limitation, not a value to infer or invent.

## MVE-deferred

- Transaction-wide source/receipt fencing.
- Cross-Team assignee hardening.
- Atomic root failure propagation.
- Generalized Lead-turn exhaustion/concurrency handling.
- Multiple Team Projects and pagination.
- Production identity, authentication, and recovery.
- Richer Lead-to-member activity links.
- Report-SHA capture in the retained handoff.

No credentials, prompts, raw provider payloads, raw errors, RuntimeSession IDs,
or machine-specific absolute paths are included here.
