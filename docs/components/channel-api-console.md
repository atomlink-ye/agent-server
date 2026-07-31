# Channel, API, and Console component

## Purpose

All human and machine channels translate into one authenticated, idempotent Task proposal and expose the same control-plane truth. A channel does not own a separate session, queue, runtime, or permission model.

## Baseline implementation

The Hono entrypoint exposes:

- `GET /health/live`;
- `GET /health/ready`;
- `POST /api/v1/runs`;
- `GET /api/v1/runs/{run_id}`.

Request IDs are returned and logged. Bodies are limited to 64 KiB. Zod rejects unknown fields and caller model selection. Runtime readiness is checked before accepting a Run. Responses never include the stored prompt or raw provider errors.

### Web Chat MVE

The Web implementation is a separate Next.js service rather than a browser
connection to Paseo. Its same-origin BFF bootstraps or recovers the fixed
ProductSession, proxies Messages, verifies Run ownership through the session's
durable Messages, and forwards upstream SSE bytes without parsing or buffering.
It forwards `after` and `Last-Event-ID`, and the browser uses native
`EventSource`. Only the HttpOnly `product_session_id` reaches the browser; the
Agent Server bearer is read and used server-side.

The rich-events stream contract carries complete assistant-text snapshots plus
flat scalar reasoning progress, Tool status, final usage, and read-only
permission activity. The reducer replaces transient text by event sequence,
ignores compatibility final text and unknown runtime events, and then refetches
the formal Assistant Message. Runtime activity is compact and secondary to the
conversation. SSE closes on a persisted terminal Event. Pre-terminal
disconnects fall back to polling, and stale SSE/poll callbacks are
identity-guarded. This is one fresh-ProductSession local MVE, not a production
console or security boundary.

The fixed command-only Lark compatibility adapter is disabled by default. When
enabled, it fixes one App/domain, allowlisted chat and external user, bot mention
identity, and service-account Tenant/Workspace/published AgentVersion tuple. The
WebSocket receiver derives verified mentions and commits bounded ingress before
acknowledgement. Replies in an existing Lark thread use the root binding and its
Product Session. Unrelated roots/threads in the same chat retain separate
bindings and Sessions. Successive Agent Runs in one Product Session reuse the
bound idle provider Agent when continuation is available; Thread command remains
fallback. This is a compatibility seam, not a canonical User/Membership or
production channel platform.

Every Card-eligible Memory proposal immediately creates a Bot-owned editable Doc
before the initial `card_with_doc` surface. New Cards show only `Open Doc`,
`Accept`, and `Reject`; legacy edit/Preview actions remain inbound-only. Direct
Accept resumes the exact source Agent and terminal provenance distinguishes the
source-message root from legacy Card-action Preview successors.

## V1 responsibilities

- Web/API/Lark identity adaptation and Task proposal normalization.
- Idempotency, authorization, policy snapshot, and materialize-first admission.
- Task tree, current Run, queue position, completion criteria, approval, Artifact, and error views.
- Cursor-based control-plane events; clients do not subscribe directly to Paseo.
- Durable idempotent delivery back to Lark/Web/API consumers.
- Fixed Lark command-path ownership: four channel tables, safe provider IDs only,
  no raw event retention, and bounded outbox attempts with explicit
  `delivery_unknown` when provider execution cannot be reconciled.

The baseline Run API is intentionally temporary. The V1 public contract is Task invocation described in [Run API contract](../contracts/run-api.md).

Preview successor lease fencing, post-canonical retry/fencing, manual rebuild
races, rolling allocator races, generalized synthesis retry/audit, multi-node
leadership, crash recovery, broad redrive/fault injection, and performance
hardening are deferred to the Task 14 follow-up. The command/Card/Doc canary
must not be read as V1 or production readiness.
