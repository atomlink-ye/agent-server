# Channel, API, and Console component

## Purpose

All human and machine channels translate into authenticated control-plane operations and expose the same durable product truth. A channel does not own a separate runtime, permission model, or hidden orchestration truth.

## Baseline implementation

The Hono entrypoint owns the authenticated `/api/v1/*` contracts and the browser-safe `/api/*` facade used by the canonical Vite client. Request IDs are returned and logged. Bounded Zod contracts reject unknown fields where the public contract is strict. Browser code never receives the service-account bearer and never connects directly to Paseo.

### Coworker Chat / Work Vite surface

The canonical Web surface is the single Vite client in `apps/web`. Agent Server hosts the browser-safe facade so credentials remain server-side.

The two sibling product views are:

- **Conversations** — long-lived Direct Chat with published Definition-backed Coworkers;
- **Work** — Product Work / WorkRun browsing and detail.

Direct Chat identity is URL-backed at `/conversations/:conversationId`. The root `/` remains a compatibility entry and converges to an available Direct Chat. Opening a first-class Work Card from Chat uses `/work/:workId?from_conversation=:conversationId`; returning from Work uses the same URL-carried origin, so refresh does not erase the Chat relationship.

The browser converges durable facts with bounded polling instead of inventing another realtime layer: conversation roster every 5 seconds while Conversations is visible, selected transcript every 3 seconds while visible, and Work Card every 3 seconds only while the safe Product state is `running` or `needs_you`. Visibility changes pause polling and visibility restoration triggers an immediate refresh. Terminal/unavailable Work Cards stop polling.

The Coworker picker reads the published chat-available Agent roster through the browser-safe `/api/agents` facade. It never asks for raw AgentDefinition IDs. Existing Direct Chats are reused; missing relationships use the idempotent conversation-create path. Startup reconciliation backfills already-published Coworkers from databases that predate publication-time Direct Chat provisioning. Same-owner AgentDefinitions receive their unambiguous Work Context entitlement; cross-owner Direct Chat does not imply Work authorization.

The server-side Chat/Work bridge remains authoritative for Work origin and Work wake facts. The browser URL query is navigation context only and is not an authorization or durable database relationship.

See:

- [Coworker Chat / Work surface](coworker-chat-work-surface.md)
- [Coworker Chat / Work navigation contract](../contracts/coworker-chat-work-navigation.md)
- [Coworker Golden Path page convergence](../features/coworker-golden-path-page-convergence.md)

### Fixed Lark compatibility

The fixed command-only Lark compatibility adapter is disabled by default. When enabled, it fixes one App/domain, allowlisted chat and external user, bot mention identity, and service-account Tenant/Workspace/published AgentVersion tuple. The WebSocket receiver derives verified mentions and commits bounded ingress before acknowledgement. Replies in an existing Lark thread use the root binding and its Product Session. Unrelated roots/threads in the same chat retain separate bindings and Sessions. Successive Agent Runs in one Product Session reuse the bound idle provider Agent when continuation is available; Thread command remains fallback. This is a compatibility seam, not a canonical User/Membership or production channel platform.

Every Card-eligible Memory proposal immediately creates a Bot-owned editable Doc before the initial `card_with_doc` surface. New Cards show only `Open Doc`, `Accept`, and `Reject`; legacy edit/Preview actions remain inbound-only. Direct Accept resumes the exact source Agent and terminal provenance distinguishes the source-message root from legacy Card-action Preview successors.

### Self-learning Project Lab

The fixed Project Lab is a local/single-operator observer and launcher for the self-learning Project/Team. Its same-origin strict BFF uses server-only bearer credentials and three configured bindings: workspace, Team version, and Memory Store. Launch accepts only `{}` and starts the fixed Team; aggregate reads are bounded and reconstruct durable Task, TeamRun, member, WorkItem, activity, proposal, report, and Memory receipt state on refresh. Review is root-bound to the proposal discovered in that aggregate.

The allow-list is limited to the approved learning activity tools and safe aggregate fields. Mutations require strict same-origin validation; responses are `no-store`; missing configuration fails closed. Browser code never receives the Agent Server bearer, provider/runtime IDs, local paths, prompts, raw events, raw upstream errors, or a Memory-write capability. Production or multi-user deployment requires a new authentication Human Gate.

## V1 responsibilities

- Web/API/Lark identity adaptation and canonical authorization/admission.
- Idempotency, policy snapshot, and materialize-first admission where the public contract requires them.
- Coworker, Conversation, Work, Task tree, current Run, completion, approval, Artifact, and error views.
- Cursor/event or successor realtime transport over control-plane truth; clients do not subscribe directly to Paseo.
- Durable idempotent delivery back to Lark/Web/API consumers.
- Fixed Lark command-path ownership with bounded safe provider metadata only.

The current bounded polling policy is an MVE convergence mechanism, not the V1 realtime transport commitment. Production identity, crash recovery, generalized redrive, performance hardening, and broader console administration require separate Human Gates and are not implied by this baseline.
