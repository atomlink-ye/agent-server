# Coworker Chat / Work navigation contract

## Browser routes

The canonical browser route identities for the Golden Path are:

| Route                                             | Meaning                                                                                         |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `/`                                               | Compatibility entry; converges to an available Direct Chat when one exists.                     |
| `/conversations/:conversationId`                  | Canonical selected Direct Chat.                                                                 |
| `/work`                                           | Work list / no selected Work.                                                                   |
| `/work/:workId`                                   | Selected Work detail.                                                                           |
| `/work/:workId?from_conversation=:conversationId` | Selected Work detail with a durable browser return relationship to the originating Direct Chat. |

`from_conversation` is browser navigation context only. It does not authorize Conversation or Work access and is never forwarded as an effective principal or workspace.

## Selection contract

When the Conversations surface is active and the conversation list is ready:

1. a valid route `conversationId` is authoritative and is mirrored into the AppStore;
2. the compatibility root may use a valid legacy return value, then replaces the URL with the canonical conversation route;
3. otherwise the current valid AppStore selection is kept, or the first available conversation is selected;
4. an invalid route conversation does not silently select another Coworker.

Selecting a visible conversation changes the URL to `/conversations/:conversationId`.

## Work return contract

Opening a first-class Work Card from a Direct Chat must include the originating conversation in `from_conversation`. Returning from Work uses that value to navigate to the canonical Direct Chat route. The relationship must survive a browser refresh because it is represented in the URL rather than transient router state.

The query parameter is not a database link and does not replace the durable `conversation_work_links` / Work origin records used by the server-side Work/Chat bridge.

## Browser convergence contract

Background refresh must not clear message drafts or switch a still-valid selected conversation. Refresh is active only while its owning product surface is visible.

A Work Card is live while its safe product state is `running` or `needs_you`. The client may poll the bounded chat-card projection. `complete`, `problem`, and unavailable cards are terminal for browser polling.

## Coworker provisioning contract

Published chat-available AgentDefinitions are listable through `GET /api/v1/agents` and the browser-safe `GET /api/agents` facade. Direct Conversation creation remains idempotent.

Startup reconciliation may call the same provisioning application seam used by publication and manual Direct Chat creation. It must not make roster GET routes side-effecting. Work Context is auto-provisioned only for same-owner AgentDefinitions; cross-owner Direct Chat does not imply Work authorization.
