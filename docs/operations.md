# Operations

Agent Server currently supports local development, deterministic verification, and explicit external-runtime smoke. Production deployment/SLO/backup/incident ownership remain future hardening work.

- [Local development](operations/local-development.md) is the canonical environment and command guide.
- [Runbook](operations/runbook.md) documents diagnosis and safe recovery for current runtime and datastore boundaries.
- [Lark Managed Memory command canary runbook](operations/lark-memory-command-canary-runbook.md) documents the current fixed Lark compatibility configuration and operational flow.
- `scripts/ops/` contains explicit human/operator migration and recovery utilities that remain part of the current repository.

## Local environment ownership

Development and infrastructure-backed tests share `config/local-environments.yaml` and `tooling/environment/`. Manual development uses the generic environment CLI:

```bash
pnpm local-env -- up core
pnpm local-env -- up runtime
pnpm local-env -- info
pnpm local-env -- down
```

A one-off command that needs infrastructure uses the same lifecycle:

```bash
pnpm local-env -- run postgres -- <command>
pnpm local-env -- run runtime -- <command>
```

Do not create scenario-specific setup/acceptance runners for temporary debugging. Improve the shared environment or typed fixture APIs instead.

## Generated diagnostics

Operational/test diagnostics generated for one run belong under ignored `.local/test-runs/<run-id>/` or a CI artifact. Logs, screenshots, recordings, provider observations, evidence ledgers, and task handoffs are not durable repository documentation.

Never place prompts, assistant bodies, service tokens, provider/call/child IDs, raw provider payloads, chain-of-thought, credentials, absolute private paths, or unbounded output in retained diagnostics.

## External runtime verification

Real Paseo/provider behavior is an explicit smoke boundary, not an ordinary deterministic PR prerequisite:

```bash
pnpm smoke:runtime
pnpm smoke:agent-team
```

Credentials must come from an external environment/secret source. Provider availability is external state and may legitimately block a smoke without invalidating deterministic repository verification.

## Production boundary

Production operations still require separate work for deployment topology, durable storage policy, backup/restore, secret management, metrics/alerts, reconciliation, incident ownership, and release/hardening gates. This repository cleanup does not claim those capabilities.
