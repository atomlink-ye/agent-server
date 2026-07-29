# Security

The current walking skeleton is not production-ready. It has no authentication,
tenant isolation, credential broker, durable audit log, rate limit, or sandbox
policy. Local development is Docker-first and provides process isolation from
the host's Paseo/OpenCode installation; it is not production sandboxing or
tenant execution isolation.

## Baseline controls

- The only host-published local port is the API at `127.0.0.1:3000`.
- PostgreSQL, Paseo, OpenCode, and Runtime MCP are not host-published; runtime
  listeners remain container-local.
- The Compose runtime does not mount host `node_modules`, Paseo homes, OpenCode
  homes/configuration, or host credentials.
- The external smoke creates isolated `HOME`, `XDG_*`, `PASEO_HOME`, and agent workspace directories.
- Common model API-key variables are removed from smoke child processes.
- Paseo relay, MCP injection, web UI, dictation, and voice mode are disabled in the baseline runner.
- The API does not expose prompts or raw provider exceptions.
- Callers cannot select a model through the Run API.
- Local runtime files and smoke evidence live under ignored `.local/`.

These controls reduce accidental exposure; they do not constitute tenant or execution-cell isolation.

## Never commit

- `.env` files, provider keys, OAuth tokens, cookies, Paseo homes, OpenCode auth files, runtime transcripts, or customer prompts;
- generated smoke evidence or agent workspaces;
- private Drive URLs or internal credentials in documentation and fixtures.

## V1 security direction

V1 requires canonical identity, tenant-scoped authorization, Workspace ACL, row-level isolation, audience-bound workload capabilities, a credential broker, approval policy, audit, and execution-cell isolation. See [Tenancy and security](docs/architecture/tenancy-and-security.md) and [release gates](docs/quality/release-gates.md).

## Reporting

Report suspected credential exposure, cross-tenant access, unsafe provider fallback, or execution escape privately to the repository owner. Do not include live secrets or customer data in an issue. Revoke exposed credentials first, preserve sanitized evidence, and follow the [operations runbook](docs/operations/runbook.md).
