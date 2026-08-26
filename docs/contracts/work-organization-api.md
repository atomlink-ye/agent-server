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
- `created_by`;
- optional paired `source_conversation_id` + `source_message_id`;
- optional `linked_work_id`;
- `created_at`, `updated_at`.

Conversation source references are accepted only as a pair. Creation validates that the requester can read the Conversation and that the source Message is already durable before the WorkItem is materialized.

Status is coordination state. The UI can move among the closed values, but it cannot infer state from runtime output. When a linked Work has canonical Product state `complete`, an owner-scoped WorkItem read/list projects the WorkItem to `in_review` unless it is already `in_review` or `done`. Only an explicit WorkItem update marks `done`.

### Routes

| Method  | Path                               | Success | Semantics                                                                                             |
| ------- | ---------------------------------- | ------- | ----------------------------------------------------------------------------------------------------- |
| `GET`   | `/api/v1/work-items`               | `200`   | Lists owner-scoped WorkItems with bounded linked-Work summaries.                                      |
| `POST`  | `/api/v1/work-items`               | `201`   | Creates a durable WorkItem; optional source and Board placement are validated before materialization. |
| `GET`   | `/api/v1/work-items/{id}`          | `200`   | Reads one WorkItem and current linked Work Product projection.                                        |
| `PATCH` | `/api/v1/work-items/{id}`          | `200`   | Updates title, description, status and/or assignee.                                                   |
| `POST`  | `/api/v1/work-items/{id}/promote`  | `200`   | Idempotently creates/reuses one formal linked Work through canonical `WorkIdentityApi`.               |
| `GET`   | `/api/v1/work-items/{id}/comments` | `200`   | Lists persistent comments in creation order.                                                          |
| `POST`  | `/api/v1/work-items/{id}/comments` | `201`   | Adds one bounded comment authored by the authenticated principal.                                     |

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

A Board is a Workspace-scoped coordination projection. A WorkItem can exist without a Board. In this MVE a WorkItem has at most one Board placement, represented separately from the WorkItem so Board ownership does not leak into the core coordination object.

### Routes

| Method   | Path                                     | Success | Semantics                                                                 |
| -------- | ---------------------------------------- | ------- | ------------------------------------------------------------------------- |
| `GET`    | `/api/v1/boards`                         | `200`   | Lists owner-scoped Boards.                                                |
| `POST`   | `/api/v1/boards`                         | `201`   | Creates a Board.                                                          |
| `GET`    | `/api/v1/boards/{id}`                    | `200`   | Returns Board, ordered columns, placements, and the referenced WorkItems. |
| `PATCH`  | `/api/v1/boards/{id}`                    | `200`   | Updates title/description.                                                |
| `DELETE` | `/api/v1/boards/{id}`                    | `204`   | Deletes Board projection; WorkItems remain.                               |
| `POST`   | `/api/v1/boards/{id}/columns`            | `201`   | Creates an ordered column.                                                |
| `PATCH`  | `/api/v1/boards/{id}/columns/{columnId}` | `200`   | Updates column title/position.                                            |
| `DELETE` | `/api/v1/boards/{id}/columns/{columnId}` | `204`   | Removes the column and its placements; WorkItems remain.                  |
| `PUT`    | `/api/v1/boards/{id}/placement`          | `200`   | Creates or moves one WorkItem placement to the requested column/position. |

Board creation, column creation, placement, rename/delete, and drag/move are product coordination operations only. They never create technical Tasks/Runs or call an Agent runtime.

## Conversation and Work bridges

The browser can create a WorkItem from any persisted Conversation message through the normal `POST /api/work-items` facade, after giving the user an editable title/description form. The message is unchanged and remains the source context.

A WorkItem can be promoted to Work. Work execution then uses the existing Work/WorkRun APIs. Opening a linked Work or returning to the originating WorkItem/Conversation changes selection inside the single Vite Coworker Workspace shell; it does not create a parallel dashboard.

## Persistence and recovery boundary

`0062_coworker_work_organization.sql` adds durable WorkItem, comment, Board, column, and placement tables. The current Prove/MVE scope uses the existing single-service process for promotion serialization plus the durable unique linked-Work constraint. It does not claim multi-host promotion recovery or a generalized workflow engine.

The WorkItem/Board state is canonical database state. Frontend optimistic/drag UI must converge by re-reading the bounded API response.
