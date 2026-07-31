# Operations

The baseline supports local development and external smoke only. It has no production deployment or SLO.

- [Local development](operations/local-development.md) covers installation, commands, configuration, and process isolation.
- [Runbook](operations/runbook.md) covers diagnosis and safe recovery for the current boundaries.
- [Lark Managed Memory command canary runbook](operations/lark-memory-command-canary-runbook.md) covers fixed configuration, readiness, one-consumer operation, verification, and graceful shutdown.
- [Lark Managed Memory Card/Doc evidence](evidence/lark-managed-memory-card-doc-canary-evidence-packet.md) records the sanitized normal-path provider boundary.
- [Task 14 hardening plan](exec-plans/active/2026-07-25-lark-memory-task14-hardening.md) owns deferred lease, retry, recovery, multi-node, and performance work; it is not part of the current PR.

## Web Chat rich-events MVE

The supported local path is Docker-first: Node `24.18.0`, pnpm `11.7.0`, Paseo
`0.1.110`, and OpenCode `1.18.4`. The sanitized real-session evidence is in
[the rich-events evidence packet](evidence/web-chat-rich-events-mve-evidence-packet.md).
It proves a fresh ProductSession browser path with live assistant Markdown,
cumulative sanitized Thinking, typed Tool detail, direct-child activity,
terminal convergence, and refresh recovery. The formal ProductSession Messages
remain transcript truth. The latest secure acceptance also proved same-provider
Paseo rendering, exact CORS behavior (`101` for the reference origin and `403`
for an untrusted origin), and a clean browser security scan.

Do not place prompts, assistant bodies, service tokens, provider/call/child IDs,
raw provider payloads, chain-of-thought, credentials, absolute paths, or
unbounded output in operational evidence. The runtime projection may retain
only bounded sanitized cumulative Thinking, safe Tool detail kind/text/exit
code, and direct-child assistant/Thinking/Tool rows. Cancel UI and old-session
restart recovery remain deferred.

During evidence capture, a transient favicon `500` was caused by running
`next build` concurrently with `next dev` while both shared generated `.next`
state. Stopping Web, deleting only generated `.next`, and restarting resolved
it; this is workflow evidence, not product behavior. The stack remains running
and no volume is deleted by this procedure.

Production operations require a separate plan covering deployment topology, durable storage, migrations, backup/restore, secret management, metrics, alerts, reconciliation, and incident ownership.
