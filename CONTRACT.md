# WorkItem claim + mention contract

Backend contract for the Cumora-style Kanban behaviour on the existing
`product_work_items` / `product_work_boards` plane. Written for the Worker
building `apps/web` against this API: **nothing in this document changes an
existing field's meaning**, everything is additive.

Runtime natural language (wake messages, agent-facing tool descriptions, new
error copy, example data) is **Chinese**; code, comments, and this document stay
English.

---

## 1. Database

Migration: `src/infrastructure/postgres/migrations/0064_work_item_mentions_and_column_kinds.sql`
(registered in `durableKernelMigrationFileNames`). Idempotent, single
transaction, no destructive step.

| Table                        | Column     | Type             | Default       |
| ---------------------------- | ---------- | ---------------- | ------------- |
| `product_work_board_columns` | `kind`     | `text NULL`      | `NULL`        |
| `product_work_items`         | `mentions` | `jsonb NOT NULL` | `'[]'::jsonb` |
| `product_work_item_comments` | `mentions` | `jsonb NOT NULL` | `'[]'::jsonb` |

Constraints: `kind IS NULL OR kind IN ('todo','doing','done')`;
`jsonb_typeof(mentions) = 'array'` on both mention columns.

### Column `kind` backfill

`kind` is what a column **means**, as opposed to what it is called. The backfill
only sets it on an exact, case-insensitive, trimmed title match:

- `todo`, `to do` → `todo`
- `doing` → `doing`
- `done` → `done`

Everything else stays `NULL`. A board titled _Backlog / In flight / Shipped_ is
left unclassified on purpose: a fuzzy guess would silently start moving a user's
cards on claim. `NULL` means "this board uses its own workflow — do not touch
placement", and that is the safe default.

---

## 2. Mentions

`@<token>` in WorkItem `title` + `description`, and in a comment `body`, is
parsed at write time into the `mentions` array.

- Pure function: `parseMentions(text, targets)` in
  `src/domain/work-organization/work-item-mentions.ts`. No clock, no I/O — the
  same text with the same roster always yields the same array, so re-saving
  unchanged prose wakes nobody.
- A token matching a known agent (display name or normalized name,
  case-insensitive) is stored as that agent's **AgentDefinition id**. A token
  matching nothing is stored verbatim, lowercased, rather than dropped.
- `@all` is reserved and never resolves to an identity, so it never wakes.
- Deduplicated in first-appearance order; capped at 64 entries.
- Wire shape: `mentions: string[]` on `WorkItemSchema` and
  `WorkItemCommentSchema` (always present, possibly empty).

An **explicit `assignee_id` is an implicit mention**: assigning wakes the
assignee exactly as typing their name would, with `reason: 'assignment'`.

---

## 3. Wake on mention

One chokepoint: `wakeMentionedAgents` in
`src/application/work-organization/wake-mentioned-agents.ts`.

```ts
wakeMentionedAgents(deps, {
  tenantId, workspaceId,
  mentions: string[],          // ids or raw tokens
  actorId, actorType,          // who wrote the text
  reason?: 'mention' | 'assignment' | 'comment',
  quote?: string,              // comment body, when there is one
  workItem: { id, title, boardId?, columnId? },
}) // -> { woken, skipped }
```

Called from WorkItem create (new mentions + explicit assignee), WorkItem update
(only mentions **not** present in the previously stored array, plus a changed
non-null assignee), and comment create.

Filtering: a mention only wakes when it resolves to an active agent identity in
the tenant. Humans, unknown tokens, and the actor themselves are skipped — you
cannot wake yourself by typing your own name.

**Best-effort by contract.** A wake failure never rolls back or fails the
WorkItem mutation; it is swallowed and logged
(`work_item.mention.roster_unavailable`, `work_item.mention.runtime_unavailable`,
`work_item.mention.wake_failed`). A chat outage must not cost the user their
card.

### Design decision: how a mention reaches an agent with no conversation

This is the decision the brief asked to be written down rather than fudged.

The wake uses the **existing chat wake primitive**, not a side channel:

1. `ConversationRepository.findOrCreateDirect({ tenantId, principalId: actorId, principalType, agentDefinitionId })`
2. `appendMessage(...)` — the brief, authored by the **actor principal**, with
   `turnMetadata { kind: 'work_item_mention_wake', workItemId, reason }`
3. `getUnread(...)`
4. `enqueueChatDispatchForMessage(...)`

That is exactly the path `POST /api/v1/conversations/:id/messages` takes.

Two things forced this shape:

- **The message must be principal-authored.** `ChatActivationPlanner.plan()`
  returns `null` when the latest message was authored by an
  `agent_definition`. The existing `WorkChatWakeDeliveryPort` appends _as the
  agent_, so reusing it verbatim would produce a message that never activates
  anything. The mention is genuinely a human speaking to the agent, so
  principal authorship is also the honest representation.
- **"No existing conversation" is not a special case.** `findOrCreateDirect` is
  idempotent, so the answer is: the mention _opens the direct conversation_
  between the actor and that Coworker, and every later mention lands in the same
  thread. No new conversation kind, no orphan channel, and the human can scroll
  back through the whole history of what they handed to that agent.

The brief text (`work-item-mention-brief.ts`, Chinese) names the WorkItem, the
reason, the Board/Column when the item is on a board, the quoted comment when
there is one, and then the exact claim instruction: call
`agent-server/work-item-claim` with `{"work_item_id":"<id>"}`, that claiming is
atomic, and that a rejected claim means someone else is already on it. Off-board
items say nothing about columns at all — telling an agent about a Doing column
that cannot exist invites it to go hunting for one.

---

## 4. Atomic claim

`rowCount` is the only source of truth. There is no SELECT-then-UPDATE anywhere
in the claim path.

```sql
WITH claimed AS (
  UPDATE product_work_items
     SET assignee_id=$4, updated_at=$5
   WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3
     AND (assignee_id IS NULL
          OR assignee_id=$4
          OR updated_at < $5::timestamptz - make_interval(mins => $6::int))
   RETURNING *
), moved AS ( /* placement compare-and-swap, guarded by EXISTS(SELECT 1 FROM claimed) */ )
SELECT claimed.*, (SELECT column_id FROM moved) AS moved_to_column_id FROM claimed
```

One statement → one implicit transaction, so the claim and the board move commit
or fail together. Claimable when: unassigned, already yours (idempotent
re-claim), or stale — `updated_at` older than **20 minutes**
(`WORK_ITEM_CLAIM_STALE_AFTER_MINUTES`), which is the escape hatch for a crashed
agent that would otherwise hold a card forever.

**Forward-only board advance.** On success, if the item is on a board, it moves
into that board's `kind='doing'` column — but only when the current column is
`kind='todo'`. Never from `done`, never out of an unclassified (`NULL`) column,
never backwards. With several `doing` columns the leftmost wins, so the choice is
deterministic. The rule is a pure function, `claimTargetColumn`, in
`src/domain/work-organization/board-column-kinds.ts`. The placement UPDATE is a
compare-and-swap on the column observed just before, so a concurrent drag loses
the _move_, never the _claim_.

Callable by a human (UI button) and by an agent (MCP tool) through the same
service method.

### `POST /api/v1/work-items/:workItemId/claim` (service-account plane)

Request: `{}` — strict, an unknown field is a `400`. The claimant is the
authenticated principal.

Response `200`:

```json
{
  "work_item": { "...": "WorkItemSchema, assignee_id now the claimant" },
  "moved_to_column_id": "uuid-or-null"
}
```

Errors: `404 work_item_not_found`, **`409 work_item_claim_conflict`** (someone
else holds it — do not start).

### `POST /api/work-items/:workItemId/claim` (browser BFF)

Same request/response, forwarded with session credentials, following the
existing `/api/work-items/:id/promote` pairing. `400 invalid_request` on a
non-UUID id or an unknown body field.

> Note for the frontend Worker: the path suffix is `/claim`, matching this
> repo's existing `/promote` route convention, rather than the `:claim` suffix
> sketched in the task brief.

### Column `kind` on the Board API

`WorkBoardColumnSchema` gains `kind: 'todo'|'doing'|'done'|null` (always
present). `POST /api/v1/boards/:boardId/columns` and
`PATCH .../columns/:columnId` accept optional `kind` (nullable); omitting it on
PATCH leaves the stored value untouched.

---

## 5. MCP tool for Coworkers

- Tool ref: **`agent-server/work-item-claim`**
  (`AGENT_SERVER_WORK_ITEM_CLAIM_TOOL_REF`, in `SUPPORTED_MANAGED_AGENT_TOOL_REFS`)
- Tool name: **`work_item_claim`**
- Input: `{ "work_item_id": "<uuid>" }` (strict)
- Success: `{"claimed":true,"work_item_id":"…","assignee_id":"…","moved_to_column_id":"…|null"}`
- Lost race: an error result with
  `{"claimed":false,"reason":"work_item_claim_conflict","holder_id":"…","message":"…"}`
  — a lost race is an ordinary outcome, so it comes back as structured data the
  agent can act on.

Registered through the same pipeline as `AGENT_SERVER_PRODUCT_WORK_CREATE_TOOL_REF`
and `AGENT_SERVER_PRODUCT_WORK_RUN_START_TOOL_REF`: tool ref constant → supported
refs → `createRuntimeToolCatalog` contributor (`workOrganization`) → per-call
`authorize(ref)`.

This is the **product coordination plane**. It is deliberately unrelated to the
Team-collaboration `board_*` tools in
`src/domain/collaboration/canonical-collaboration-tools.ts`, which coordinate
members inside a single TeamRun. No collaboration code was touched.

**Claimant identity.** A chat runtime's scope id is the AgentChatRuntime id, not
the AgentDefinition id, so the claimant is resolved from the conversation's
`agent_definition` member (`ConversationAgentIdentityResolver`, mirroring
`PostgresWorkChatConversationAgentResolver`). Without a chat context, or with an
ambiguous membership, the tool refuses in Chinese rather than claiming under the
platform principal and leaving a human to untangle a wrong `assignee_id`.

---

## 6. Not in scope here

- `apps/web/*` untouched — the frontend Worker owns it.
- `src/domain/collaboration/`, `src/application/collaboration/` untouched.
- Chinese was applied to text **this feature** authors. Pre-existing English
  runtime strings on this plane (e.g. `'The requested WorkItem was not found.'`,
  `'boardId and columnId must be supplied together.'`, existing product-work MCP
  descriptions) were left alone: a repo-wide sweep would break assertions across
  the existing suite and is a separate decision.
