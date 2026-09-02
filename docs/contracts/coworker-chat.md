# Coworker Chat Contract

Status: implemented MVE contract

This contract defines the Cumora-aligned relationship between a long-lived managed Agent identity, its Chat runtime, Direct Conversation provisioning, and formal Work capability. It deliberately keeps the Chat plane and the formal Work plane separate.

## Stable object model

```text
AgentDefinition             long-lived Coworker identity
├── AgentVersion            immutable executable capability snapshot
├── AgentHome               durable identity-owned private state
└── AgentChatRuntime        mutable operational head
    ├── activeAgentVersionId
    ├── epoch
    └── RuntimeSession      replaceable provider/runtime binding for one epoch

Conversation                durable relationship / message history
└── work entitlement        scoped permission to use one Product Workspace

Work                        independent formal execution object
└── WorkRun / Attempt       version-pinned execution and trace
```

There is no separate `AgentInstance` product identity in this MVE. Changing provider session, runtime host, active AgentVersion, or Chat epoch does not replace the AgentDefinition identity.

## Coworker roster

`GET /api/v1/agents` is the product-facing Coworker roster for the authenticated tenant. It requires the existing service-account bearer authentication and uses the same tenant visibility boundary as other managed Agent reads.

Only managed AgentDefinitions with an `agent_chat_runtimes` row are listed, so an imported draft that has never been published is not an available Coworker. The response is:

```json
{
  "items": [
    {
      "id": "<agent-definition-uuid>",
      "normalized_name": "research-analyst",
      "display_name": "Research Analyst",
      "created_at": "2026-08-22T00:00:00.000Z",
      "updated_at": "2026-08-22T00:00:00.000Z",
      "role_label": "Researcher",
      "summary": "Investigates markets and evidence.",
      "links": {
        "self": "/api/v1/agents/<agent-definition-uuid>",
        "versions": "/api/v1/agents/<agent-definition-uuid>/versions"
      },
      "active_agent_version_id": "<published-version-uuid>",
      "runtime_status": "available"
    }
  ],
  "next_cursor": null
}
```

`runtime_status` is the closed `available | draining | unavailable | working | thinking` vocabulary. `ChatDeliveryReconciler` is the only writer today: it CAS-transitions the runtime from `available` to `working` for the duration of one in-flight Chat turn and back to `available` when that turn ends (success or failure), so a runtime with an in-flight turn reports `working` and defers (never overlaps) a second concurrent turn. `draining` / `unavailable` are reserved for other lifecycle writers; `thinking` is reserved for a future finer-grained "model is generating" signal and is not yet written. Provider RuntimeSession IDs, provider agent/thread IDs, prompts, credentials, model names, tenant/principal IDs, and raw runtime payloads are not part of this response.

The same `cursor` / `limit` rules as managed Agent version lists apply: default limit 20, allowed 1–100, opaque repository cursor, unknown or ambiguous query parameters rejected.

The Vite browser client reads the roster through the same-origin `GET /api/agents` BFF. The BFF owns the service-account credential, validates/strips the upstream response against the public schema, and returns `Cache-Control: no-store`; the browser never receives the bearer.

## Publish-to-relationship lifecycle

Successful managed Agent publication establishes the operational Chat head and then converges the owner relationship:

```text
publish AgentVersion
→ upsert AgentChatRuntime
→ ensure Direct Conversation(owner principal, AgentDefinition)
→ if Work plane is enabled and ownership is unambiguous:
     ensure conversation_work_entitlement to AgentDefinition.workspaceId
```

Publication remains idempotent. A replay of the same publish idempotency key also retries the relationship provisioning, so a prior post-publication provisioning failure can converge without creating duplicate Conversations or entitlements.

If the Direct Chat plane is disabled, publication does not create a Conversation. If formal Work is disabled, publication may provision the Direct Conversation but does not create a Work entitlement.

## Direct Conversation admission

`POST /api/v1/conversations` remains an explicit idempotent entry point for opening a Coworker from the roster. Its body remains:

```json
{ "agent_definition_id": "<uuid>" }
```

The UUID is an API identity, not a user-facing manual entry. The Vite UI obtains it from the roster and shows Coworker name/role/summary instead of exposing a raw AgentDefinition-ID input.

Admission requires:

1. the AgentDefinition exists in the authenticated tenant;
2. its AgentChatRuntime exists and has `status = available`;
3. the authenticated principal is admitted as the human member.

The repository's Direct pair key makes repeated open/publish actions resolve the same Conversation for the same `(tenant, principal, AgentDefinition)`.

## Work entitlement boundary

`conversation_work_entitlements` remains a security/context boundary. The MVE does not attach a global Workspace to the Agent identity and does not make all Conversations inherit Work access.

Automatic provisioning is allowed only when the Direct Chat caller is exactly the AgentDefinition owner (`principalType` and `principalId` both match). In that case the durable `AgentDefinition.workspaceId` is the one unambiguous Product Workspace and is enabled idempotently.

Shared/cross-owner Coworkers do not receive a guessed Work entitlement. They may still have a Direct Conversation, but the existing explicit `POST /api/v1/conversations/{conversationId}/work-context` boundary remains the supported path when a caller is authorized to select/attach context.

`ChatDeliveryReconciler` continues to bind `list_agent_workflows` / `start_work` only when a valid entitlement exists. This implementation changes provisioning, not authorization bypass.

## Agent Chat RuntimeSession identity

Agent Chat RuntimeSession persistence uses typed state:

```text
runtime_sessions.scope_kind = 'agent_chat'
runtime_sessions.agent_chat_runtime_id UUID
runtime_sessions.runtime_epoch INTEGER > 0
UNIQUE (agent_chat_runtime_id, runtime_epoch) WHERE scope_kind='agent_chat'
```

The pair `(agent_chat_runtime_id, runtime_epoch)` is the durable identity for one Chat runtime binding. The legacy composite string `"<runtime-uuid>:<epoch>"` is not stored or parsed.

For compatibility, `RuntimeSession.scopeId` exposes the raw AgentChatRuntime UUID for Agent Chat rows; canonical code should use the structured `RuntimeSession.scope` object.

Epoch semantics:

- first published AgentVersion creates/uses AgentChatRuntime epoch 1;
- repeated use of the same `(AgentChatRuntime, epoch)` reuses one RuntimeSession;
- publishing a different AgentVersion increments the AgentChatRuntime epoch;
- the next Chat turn creates/selects a distinct RuntimeSession for the new epoch;
- the previous epoch RuntimeSession remains pinned to its historical AgentVersion.

Migration `0051_agent_chat_runtime_epoch_scope.sql` backfills legacy valid `agent_chat` rows that stored the raw AgentChatRuntime UUID in `scope_id` as epoch 1 before enforcing the typed identity for new rows.

## Chat versus formal Work

A Chat Agent may discuss, clarify, call platform Work tools, and emit a `ChatMessage.workRef`. A `workRef` points to the independent Work projection rendered as a Work Card.

Formal Work composition is Worker-owned: it selects published
`WorkerVersion` references and must not use the Conversation roster as an
execution roster. Publishing a Worker never creates an `AgentChatRuntime`,
Direct Conversation, or Coworker roster entry. The current Work compatibility
path may still expose Agent-shaped fields during migration; those fields do not
change this ownership rule.

Chat RuntimeSession and Worker RuntimeSession are not required to be the same session:

```text
Chat RuntimeSession
= long-lived Coworker conversation brain / relationship context

Worker RuntimeSession
= bounded, version-pinned, auditable formal Work execution
```

Work lifecycle, WorkRun/Attempt state, Run Trace, Artifact/Review semantics, and Worker runtime ownership remain authoritative in the formal Work plane.

## Explicit non-claims

This MVE does not add a Cumora-style Computer product object, Agent off-board/rehire lifecycle, Group/Whisper/Convene, proactive Agenda, full FUSE expansion, global Work access for shared Agents, Chat/Worker RuntimeSession unification, or production multi-user identity hardening.
