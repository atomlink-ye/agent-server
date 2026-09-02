# Coworker work organization API

## Purpose

This contract is the product coordination boundary between informal Conversation work and formal Work execution.

The object vocabulary is fixed:

```text
WorkItem = coordination commitment (UI label: Task)
Work     = durable product objective
Task     = technical execution-node invocation
Run      = one Task attempt
Board    = Workspace-scoped projection over WorkItems
```

The API must not introduce another product-facing object named `Task`. Boards do not own or duplicate Work execution state.

## Authorization and scope

All `/api/v1/work-items*` and `/api/v1/boards*` routes require the existing service-account bearer authentication. Tenant, Workspace, and principal scope come from the authenticated `AccessContext`; callers cannot supply effective owner fields.

The browser uses only same-origin `/api/work-items*` and `/api/boards*` facade routes. The Agent Server process owns the service credential and decodes the authenticated response through the strict schemas exported by `src/contracts/work-organization.ts`. Browser code never receives the bearer token.

Foreign or missing WorkItems/Boards are returned through the bounded not-found errors. Raw database/provider/runtime errors are never serialized.

## WorkItem contract

A WorkItem has:

- `id`, `workspace_id`;
- `title`, nullable `description`;
- `status`: `todo | in_progress | in_review | done`;
- nullable `assignee_id`;
- `mentions`: identities named by `@`-tokens in `title` + `description` at the last write;
- `created_by`;
- optional paired `source_conversation_id` + `source_message_id`;
- optional `linked_work_id`;
- `created_at`, `updated_at`.

Conversation source references are accepted only as a pair. Creation validates that the requester can read the Conversation and that the source Message is already durable before the WorkItem is materialized.

### Mentions and claiming

`@`-tokens in WorkItem prose and in comment bodies are parsed at write time into a stored `mentions` array. Parsing is a pure function of the text plus the tenant Coworker roster, so re-saving unchanged prose produces the same array and wakes nobody. A token that resolves to an active Coworker is stored as that AgentDefinition id; an unresolved token is kept verbatim and wakes nobody.

A new mention — and an explicit `assignee_id`, which counts as an implicit mention — wakes the named Coworker through the existing direct-chat wake path (`findOrCreateDirect` -> principal-authored message -> chat dispatch). Waking is best-effort: a chat failure is logged and never rolls back or fails the WorkItem mutation.

A durable per-WorkItem counter breaks a mutual-wake loop: `wakeMentionedAgents` refuses to wake past `DEFAULT_WAKE_LOOP_HARD_CAP` (20) consecutive agent-caused wakes on the same WorkItem with no human back in the loop. A human-caused mention or comment resets the counter. This is a different axis from `MAX_WORK_ITEM_MENTIONS` (a width limit on one message's @-tokens): the loop guard bounds depth across turns, not breadth within one turn. See `src/application/work-organization/wake-loop-guard.ts`; the count-vs-cap comparison itself is generic (`src/application/coordination/loop-cap-guard.ts`), shared in spirit — not in storage or reset semantics — with the unrelated Team-collaboration `maxLeadTurns` backstop.

Claiming a WorkItem is a single atomic `UPDATE` whose matched-row count is the only source of truth. A WorkItem is claimable when it is unassigned, already held by the claimant, or stale (`updated_at` older than 20 minutes, the escape hatch for a crashed Coworker). A successful claim on a Board also advances the card from a `todo` column into that Board's `doing` column — forward only, never out of an unclassified column. Losing the race is `409 work_item_claim_conflict`, not a silent no-op.

Status is coordination state. The UI can move among the closed values, but it cannot infer state from runtime output. When a linked Work has canonical Product state `complete`, an owner-scoped WorkItem read/list projects the WorkItem to `in_review` unless it is already `in_review` or `done`. Only an explicit WorkItem update marks `done`.

### Routes

| Method  | Path                               | Success | Semantics                                                                                                                                         |
| ------- | ---------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`   | `/api/v1/work-items`               | `200`   | Lists owner-scoped WorkItems with bounded linked-Work summaries.                                                                                  |
| `POST`  | `/api/v1/work-items`               | `201`   | Creates a durable WorkItem; optional source and Board placement are validated before materialization.                                             |
| `GET`   | `/api/v1/work-items/{id}`          | `200`   | Reads one WorkItem and current linked Work Product projection.                                                                                    |
| `PATCH` | `/api/v1/work-items/{id}`          | `200`   | Updates title, description, status and/or assignee.                                                                                               |
| `POST`  | `/api/v1/work-items/{id}/claim`    | `200`   | Atomically claims the WorkItem for the caller; advances a `todo` placement into the Board's `doing` column. `409` when another claimant holds it. |
| `POST`  | `/api/v1/work-items/{id}/promote`  | `200`   | Idempotently creates/reuses one formal linked Work through canonical `WorkIdentityApi`.                                                           |
| `GET`   | `/api/v1/work-items/{id}/comments` | `200`   | Lists persistent comments in creation order.                                                                                                      |
| `POST`  | `/api/v1/work-items/{id}/comments` | `201`   | Adds one bounded comment authored by the authenticated principal.                                                                                 |

Promotion requires explicit `definition_id` and published `definition_version_id`, preserving the existing formal Work contract rather than inventing a hidden default Definition. Repeated promotion of the same WorkItem returns the already linked Work. The persistent `linked_work_id` relation is unique.

The linked Work projection contains only:

```json
{
  "work_id": "uuid",
  "title": "...",
  "product_state": "running|needs_you|complete|problem|not_captured",
  "latest_work_run_id": "uuid-or-null",
  "result_summary": "bounded-summary-or-null"
}
```

It does not expose technical Task/Run trees, provider identity, prompts, credentials, or raw execution events.

## Board contract

A Board column carries a nullable `kind` (`todo | doing | done`) describing what the column _means_, as opposed to what it is called. `null` means the meaning is not declared, and placement automation then leaves that column alone: a board titled _Backlog / In flight / Shipped_ is never guessed at, because a wrong guess silently moves a user's cards.

A Board is a Workspace-scoped coordination projection. A WorkItem can exist without a Board. In this MVE a WorkItem has at most one Board placement, represented separately from the WorkItem so Board ownership does not leak into the core coordination object.

### Routes

| Method   | Path                                     | Success | Semantics                                                                 |
| -------- | ---------------------------------------- | ------- | ------------------------------------------------------------------------- |
| `GET`    | `/api/v1/boards`                         | `200`   | Lists owner-scoped Boards.                                                |
| `POST`   | `/api/v1/boards`                         | `201`   | Creates a Board.                                                          |
| `GET`    | `/api/v1/boards/{id}`                    | `200`   | Returns Board, ordered columns, placements, and the referenced WorkItems. |
| `PATCH`  | `/api/v1/boards/{id}`                    | `200`   | Updates title/description.                                                |
| `DELETE` | `/api/v1/boards/{id}`                    | `204`   | Deletes Board projection; WorkItems remain.                               |
| `POST`   | `/api/v1/boards/{id}/columns`            | `201`   | Creates an ordered column with an optional `kind`.                        |
| `PATCH`  | `/api/v1/boards/{id}/columns/{columnId}` | `200`   | Updates column title/position/kind.                                       |
| `DELETE` | `/api/v1/boards/{id}/columns/{columnId}` | `204`   | Removes the column and its placements; WorkItems remain.                  |
| `PUT`    | `/api/v1/boards/{id}/placement`          | `200`   | Creates or moves one WorkItem placement to the requested column/position. |

Board creation, column creation, placement, rename/delete, and drag/move are product coordination operations only. They never create technical Tasks/Runs or call an Agent runtime.

## Conversation and Work bridges

The browser can create a WorkItem from any persisted Conversation message through the normal `POST /api/work-items` facade, after giving the user an editable title/description form. The message is unchanged and remains the source context.

A WorkItem can be promoted to Work. Work execution then uses the existing Work/WorkRun APIs. Opening a linked Work or returning to the originating WorkItem/Conversation changes selection inside the single Vite Coworker Workspace shell; it does not create a parallel dashboard.

## Coworker tool boundary

A Coworker claims product work through the managed runtime tool `agent-server/work-item-claim` (MCP name `work_item_claim`, input `{ "work_item_id": "<uuid>" }`). It resolves the claiming Coworker from the conversation's `agent_definition` member and refuses when that identity is unavailable, rather than claiming under the platform principal.

This is the product coordination plane. It is unrelated to the Team-collaboration `board_*` tools used inside TeamRun orchestration.

## Persistence and recovery boundary

`0062_coworker_work_organization.sql` adds durable WorkItem, comment, Board, column, and placement tables. `0064_work_item_mentions_and_column_kinds.sql` adds `product_work_board_columns.kind` plus `mentions` on WorkItems and comments, and backfills `kind` only on exact case-insensitive title matches. `0065_work_item_wake_loop_counters.sql` adds the per-WorkItem mutual-wake counter backing the loop guard above. The current Prove/MVE scope uses the existing single-service process for promotion serialization plus the durable unique linked-Work constraint. It does not claim multi-host promotion recovery or a generalized workflow engine.

The WorkItem/Board state is canonical database state. Frontend optimistic/drag UI must converge by re-reading the bounded API response.
