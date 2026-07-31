# Contracts

Contracts are versioned boundaries that adapters and clients must test. They are smaller than implementation internals and must preserve safe error normalization.

- [Run compatibility API](contracts/run-api.md) documents the implemented compatibility routes and their canonical Task relationship.
- [Task API](contracts/task-api.md) documents the implemented canonical invoke/read/tree routes.
- [Workspace memory API](contracts/workspace-memory-api.md) documents the implemented proposal, review, and accepted-entry governance routes.
- [Memory Store / Memory API](contracts/memory-api.md) documents the canonical API-first Store, stable Memory, immutable Version, and built-in Skill boundary.
- [Managed Workspace memory snapshots](contracts/managed-workspace-memory-api.md) documents Product Workspace-owned immutable entries, verified local projections, snapshot reads, and rebuild behavior.
- [Managed Environment API](contracts/managed-environment-api.md) documents the fixed authenticated Environment package, ProductSession pin, and internal RuntimeSession/Cell baseline.
- [Agent and Team registry contract](contracts/agent-team-api.md) documents the durable registry model and Team compatibility boundary. The managed Agent HTTP contract below is the public Phase B registry surface.
- [Health API](contracts/health-api.md) defines liveness and dependency readiness.
- [Runtime contract](contracts/runtime-contract.md) defines the leaf-agent application port and planned compatibility surface.
- [Web Chat + Paseo Streaming MVE evidence](evidence/web-chat-paseo-streaming-mve-evidence-packet.md) records sanitized fresh-session browser, SSE, persistence, and token-boundary evidence; production hardening remains deferred.
- [Managed Single-Agent V1 evidence packet](evidence/managed-single-agent-v1-evidence-packet.md) records approved minimum-scenario evidence; production hardening remains deferred.
- [Lark Managed Memory command canary](evidence/lark-managed-memory-command-canary-evidence-packet.md) records the fixed compatibility boundary and sanitized command-only evidence; it is not a production identity or delivery guarantee.
- [Lark Managed Memory Card/Doc canary](evidence/lark-managed-memory-card-doc-canary-evidence-packet.md) records sanitized normal-path deterministic/provider evidence; it is not production identity, physical exactly-once, multi-node, or crash-recovery evidence.

Changing a public field, status meaning, model-selection authority, or runtime responsibility is a Human Gate and requires contract tests plus documentation updates.

## Fixed Lark command-only compatibility contract

The implemented Lark seam is intentionally narrower than a general channel
contract. Configuration is disabled by default and fixes one App/domain, one
allowlisted chat, one allowlisted external user, one bot mention identity, and
one service-account Tenant/Workspace/published AgentVersion/policy tuple. The
tuple is checked at binding and command review; callers cannot supply an owner,
Workspace, AgentVersion, or canonical identity.

New roots require a verified mention and create the normal Product Session,
Task, and Run through trusted `lark` origin admission. Thread commands reuse the
root binding. The supported control command is `/memory
edit-and-accept <proposal_id> <bounded content>` (with corresponding bounded
accept/reject forms). Card and Bot Doc controls use the same canonical review
state; Doc body plus unresolved comments/replies are read for immutable Preview,
and `Accept Preview` accepts exactly the persisted Preview/hash. Thread command
remains fallback. All controls are kept out of Agent prompts and are authorized
by the configured chat, user, bot mention evidence, source Session, and owner
tuple.
Successful review materializes one accepted Entry and publishes a ready
immutable snapshot before the result is reported. A later new root creates a
Fresh Session that pins the exact snapshot ID/hash at admission.

Only bounded normalized fields and provider IDs are retained. Raw provider
events, callback tokens, secrets, raw provider errors, prompts, and local paths
are not retained or exposed. Outbound text uses durable outbox attempts and
provider UUID replay while safe; an ambiguous send may become
`delivery_unknown`. This is not physical exactly-once delivery. The fixed tuple
is not canonical Lark identity or production authorization.

## Managed Agent package and registry API

The Phase B managed Agent API is intentionally narrow. It exposes validation, import, owner-scoped reads, version listing, and publication only. Every route requires an enabled service-account bearer token. Managed Agent identity and read/publish scope are derived from authenticated `tenant` plus `principal`. The authenticated workspace is carried only as a legacy compatibility snapshot on import; it does not participate in managed identity, read, or publish scope. Callers cannot supply tenant, principal, or workspace values. Every response carries the supplied `x-request-id`, or a generated request ID when the header is absent. Errors use the common envelope:

```json
{
  "error": {
    "code": "safe_code",
    "message": "safe human-readable message",
    "request_id": "request-id"
  }
}
```

### Routes

| Method | Path                                               | Success | Contract                                                                                                      |
| ------ | -------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------- |
| `POST` | `/api/v1/agent-packages:validate`                  | `200`   | Read-only package validation; it does not require or use `Idempotency-Key`, and supplied headers are ignored. |
| `POST` | `/api/v1/agents:import`                            | `201`   | Creates or converges an owner-scoped definition/version; requires `Idempotency-Key`.                          |
| `GET`  | `/api/v1/agents/{agentId}`                         | `200`   | Reads an owner-scoped definition summary.                                                                     |
| `GET`  | `/api/v1/agents/{agentId}/versions?cursor=&limit=` | `200`   | Lists owner-scoped version summaries in repository order.                                                     |
| `GET`  | `/api/v1/agent-versions/{versionId}`               | `200`   | Reads an owner-scoped version summary.                                                                        |
| `POST` | `/api/v1/agent-versions/{versionId}:publish`       | `200`   | Publishes one owner-scoped version; requires `Idempotency-Key`.                                               |

`agentId`, `versionId`, and embedded resource IDs are canonical lowercase UUIDs. Invalid path IDs are rejected as `400 invalid_request` before application, repository, or idempotency work. Owner-scoped draft definitions and versions are readable and listable, and draft versions can be published. Foreign or missing resources are hidden as the same `404 agent_not_found` response.

### Request limits and idempotency

Validate and import accept only strict JSON objects of the exact shape `{ "source": "..." }`. Unknown fields, including owner, tenant, principal, workspace, or model fields, are rejected. The request body limit is 64 KiB of actual UTF-8 bytes, regardless of the `Content-Length` header. Malformed or non-UTF-8 JSON is `400 invalid_json`; an oversized body is `413 request_too_large`; a valid JSON object with the wrong shape is `400 invalid_request`.

Validation is read-only and key-free. It does not use `Idempotency-Key`; if a caller supplies that header, validation ignores it. Clients should omit the header. Import requires a non-empty `Idempotency-Key` no longer than 255 characters. Reusing a key with the same request replays the original result; reusing it for a different request is `409 idempotency_conflict`. Blank, missing, or oversized keys are `400 invalid_idempotency_key`.

Publish accepts an empty body or the exact JSON object `{}` only. It requires the same idempotency-key rules. Replaying the same key and version returns the same published summary; using that key for another version returns `409 idempotency_conflict`. Invalid JSON and unknown publish fields retain the `400 invalid_json`/`400 invalid_request` mappings.

List limits are integers from 1 through 100; the default is 20. The cursor is opaque and repository-generated. Invalid limits are `400 invalid_limit`; malformed cursors are `400 invalid_cursor`. A missing owner or definition is still `404 agent_not_found`, including for listing and publication, so existence and ownership are not disclosed.

Other stable public mappings are `401 unauthorized` with `WWW-Authenticate: Bearer`, `400 invalid_agent_package` for a package that fails validation, and `413 request_too_large` for either declared or observed body overflow. Raw database, YAML, provider, and local-path errors are not returned.

### Safe response shapes

Validation returns only:

```json
{
  "valid": true,
  "fingerprint": "sha256:<64 lowercase hex characters>",
  "metadata": { "normalized_name": "..." },
  "compiler": {
    "pattern_dialect": "re2",
    "pattern_compiler_version": "re2js-2.8.6"
  }
}
```

Definition summaries contain `id`, `normalized_name`, `display_name`, `created_at`, `updated_at`, and `links.self` plus `links.versions`. Version summaries contain `id`, `definition_id`, `status` (`draft` or `published`), `display_name`, `fingerprint`, the literal compiler values above, `created_at`, `updated_at`, `published_at`, and safe `links.self` plus `links.definition`. Timestamps are ISO datetimes and links are API paths for the corresponding canonical UUID resources. Import returns `{ result, agent, version }`, where `result` is `created`, `converged`, or `replayed`; list returns `{ items, next_cursor }`; publish returns one version summary.

The following must never be serialized in these responses, errors, or normal request logs: raw YAML/source, `package`, `canonicalJson`, instructions, prompt/template text or segments, JSON Schema, completion command, permissions, owner/tenant/principal IDs, bearer tokens, model names, database/raw errors, and local paths.

## Managed Agent package contract

The import source is one YAML 1.2 document parsed with a safe AST. It uses unique mapping keys and rejects directives, anchors, aliases, tags, merge keys, multiple documents, ASTs over 500 nodes or depth 24, collections over 64 entries, scalar strings over 16 KiB, and source over 64 KiB. The package root and every nested object are strict: unknown fields are rejected.

The package is `apiVersion: agent-server/v1alpha1`, `kind: ManagedAgent`, with a non-empty `metadata.name` and the defined `spec` fields. Its input schema is a strict subset: `object`, `string`, `number`, `integer`, `boolean`, and `array` types; `required`, `properties`, `items`, `enum`, `min`, `max`, and `pattern` where applicable; `additionalProperties` must be `false`; nested schema depth is at most 8. Patterns use the bounded RE2 dialect described below.

Input templates use exactly the grammar `{{\s*input\.([A-Za-z_][A-Za-z0-9_]*)\s*}}`. Each referenced field must be declared in the input schema. Unmatched braces and undeclared fields are rejected, and the template is bounded by the scalar limit. The built-in runtime model policy is `free-only`; callers cannot select a concrete or paid model. Runtime, session, memory, permission, and completion fields are constrained to the package enum values; package tool and skill references are parsed as data, not proof that an external tool or skill is available.

Pattern compilation uses dialect `re2` and exact compiler version `re2js-2.8.6`. A pattern is limited to 1 KiB source, 2048 compiled program units, and 16 KiB input. RE2-incompatible constructs, including backreferences and lookarounds, are unsupported and rejected.

The validated package is canonicalized to stable JSON and fingerprinted with SHA-256. Imported versions retain that immutable package identity; publication is a one-way transition to an immutable published version. The registry converges definitions and versions by normalized owner/name and fingerprint while keeping idempotent import and publication outcomes safe.

## Task relationship and compatibility

Canonical Task admission and execution resolution accept an explicit published managed Agent version ID. A draft version is rejected as not found at that Task boundary until it is published; foreign and missing versions are likewise hidden as the owner-safe not-found result. Owner-scoped draft definitions and versions remain readable/listable through the registry API and draft versions remain publishable. The existing legacy Run compatibility route and Team invokable compatibility remain; Team execution remains the implemented sequential compatibility subset rather than a claim of the full Team V1 graph contract.

## Private Workspace and Session Lane API (Phase C minimum)

These routes require the existing service-account bearer authentication and derive
tenant plus principal ownership from the authenticated request. A principal may
own multiple product Workspaces; requested product `workspace_id` values are
authorized by database ownership, not compared with the configured compatibility
Workspace. Foreign or missing resources are hidden as `404`.

| Method | Path                                     | Success | Safe semantics                                                                                                                                                     |
| ------ | ---------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST` | `/api/v1/workspaces`                     | `201`   | Creates a private Workspace from `{ "name": "..." }`; returns `workspace_id`, name, timestamps, and a safe self link.                                              |
| `GET`  | `/api/v1/workspaces/{workspace_id}`      | `200`   | Returns the owner-scoped Workspace summary.                                                                                                                        |
| `POST` | `/api/v1/sessions`                       | `201`   | Creates an active ProductSession from `{ "workspace_id": "...", "agent_version_id": "..." }`, pinning the explicit Agent Version at generation `0`.                |
| `GET`  | `/api/v1/sessions/{session_id}`          | `200`   | Returns owner-scoped session identity, generation, status, timestamps, and safe links.                                                                             |
| `GET`  | `/api/v1/sessions/{session_id}/messages` | `200`   | Returns durable user Messages in generation/sequence order with safe Task/Run IDs and statuses.                                                                    |
| `POST` | `/api/v1/sessions/{session_id}/messages` | `202`   | Admits Message, root Task, Run attempt 1, idempotency record, dispatch intent, and lane metadata in one transaction.                                               |
| `POST` | `/api/v1/sessions/{session_id}:reset`    | `200`   | Increments generation; requests cancellation for the active old-generation root and cancels only non-active queued old-generation roots with `cancelled_by_reset`. |

The minimum lane has one active root. Later Messages are durable queued roots
ordered by `(generation, sequence)`. Terminal completion promotes the oldest
eligible queued root and clears the reset cancellation request. Responses never
include owner IDs, raw prompts, provider errors, or database details. Runtime
Full Runtime Session V2 create/resume/status remains outside this MVP contract.
The minimum Phase D contract adds assistant/final Messages, replayable SSE/events,
and owner-scoped provider cancellation; incremental deltas, rich usage, retries,
and receipts remain deferred.

## Web Chat streaming boundary

The Web MVE uses a separate same-origin BFF. The browser may hold only the
HttpOnly `product_session_id`; the Agent Server service bearer is a server-side
dependency. The BFF owner-checks the requested Run through the ProductSession's
durable Messages and forwards the upstream SSE body, `after`, and
`Last-Event-ID` without parsing or buffering.

The runtime event ABI is restricted to the output payload
`{ "kind": "assistant_text", "text": "<complete snapshot>" }`. Run Events are
append-only. The Web reducer replaces snapshots by sequence and ignores raw,
unknown, and compatibility-final output. A persisted terminal Run Event closes
SSE; UI convergence additionally requires the matching formal Assistant
Message. This is an internal fresh-session MVE, not a production identity,
recovery, retention, or backpressure contract.
