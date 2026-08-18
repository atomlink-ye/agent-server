# Spike — per-role Paseo transcript retrieval

Status: **Probe, frozen 2026-08-18.** No product behaviour changes on this branch until the
probe reports a verdict.

Base SHA: `787d456` (`origin/master`, PR #76 merged).

## Question this probe answers

> For one real Agent Team run, can we retrieve **each role's** actual conversation and
> execution activity through a declared Paseo interface — and is it still retrievable after
> the run ends?

Nothing more. This is not a frontend round, not a Product API round, and not an
observability programme.

## Candidate interface (already present, not yet proven end to end)

| Step | Where |
|---|---|
| Paseo SDK public API `fetchAgentTimeline(agentId, options)` | `@getpaseo/client@0.1.110` — `dist/daemon-client.d.ts:739` |
| Our wrapper | `src/adapters/paseo/paseo-sdk-client.ts:263` |
| Gateway facade `fetchTimeline()` | `src/adapters/paseo/paseo-gateway.ts:109` |
| Role → Paseo agent id | `team_member_runs.runtime_session_id`, keyed by `(team_run_id, name)` — `migrations/0020_collaborative_team_mve.sql:49` |

Two things are explicitly **not** established and must not be assumed:

1. `fetchAgentTimeline?` is declared **optional** on the port (`paseo-client-port.ts:246`) and
   `fetchTimeline()` returns `… | null`. Whether it is non-null against a real runtime is
   part of what this probe measures.
2. `subscribeAgentStream()` is a **shared** `agent_stream` subscription. Its existence does
   **not** by itself demonstrate per-role history retrieval, and must not be cited as if it did.

## Pass / fail

**Pass** requires, from one real run with at least two roles:

- each role's history fetched separately, and attributable to that role;
- at least one fresh, role-attributed streaming event observed live;
- a stated answer on post-run readability;
- every interface used identified as CLI / declared SDK API / HTTP route.

**Fail** is a legitimate outcome and is reported as such. What is *not* acceptable is
substituting any of the following for the observation above:

- an existing frontend transcript;
- a fixture or recording;
- added instrumentation that manufactures the evidence it then reports.

Reaching into `node_modules` internals or private state files does not count as a supported
interface; gaps found there are recorded as upstream gaps instead.

## Boundaries

Out of scope on this branch: frontend/UI, Product API contract changes,
`src/application/product-projection/**`, new persistence, execution-side capture changes,
repository-wide gates, and any interaction with the in-flight `feat/work-execution-experience-mve`.

Evidence location: round directory
`tasks/active/agent-server-implementation-20260722/rounds/2026-08-18-paseo-role-transcript-spike/`
(outside this repository), with credentials redacted.
