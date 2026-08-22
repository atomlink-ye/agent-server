---
name: agent-server-pre-push-checks
version: 1.0.0
triggers: [before repository push, before review handoff]
inputs: [verified base ref]
outputs: [relevant validation commands and results]
permissions: [run repository validation commands]
---

# Agent Server Pre-Push Checks

Use the outgoing diff to select the smallest credible local evidence. The CI matrix remains responsible for broader coverage.

1. Confirm repository, branch and the verified PR base.
2. Run `pnpm scope:changed --base <verified-base>`.
3. Select checks by affected surface: focused Vitest for behavior, docs/gates for repository prose and rules, build for entrypoints, Web type/build/browser checks for Web changes, real PostgreSQL only for PostgreSQL-specific semantics, and runtime canaries when provider credentials are available.
4. Do not repeat an already-passing command without a change that could invalidate it.
5. Treat a relevant deterministic failure as a blocker and report external/environment checks separately when they could not run.
6. After a base change, recompute scope and rerun the checks affected by that base change.
