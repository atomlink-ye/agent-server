---
status: completed
owner: orchestrator
created_at: 2026-07-31
updated_at: 2026-08-01
authority: design-spec
---

# Web Chat Session History and Activity Replay MVE Spec

## Outcome

Make the Web Chat mental model explicit and useful:

```text
one Chat = one ProductSession = one RuntimeSession/provider Agent context
```

Users can start a New Chat, reopen previous chats from a sidebar, continue the
same Agent context inside a selected chat, and inspect each completed turn's
safe runtime activity after terminal and refresh.

## Authority and observed baseline

- The user approved an owner/workspace-scoped public Session list API and
  bounded transcript-derived title/preview fields with no migration.
- The current observed multi-turn ProductSession has four successful Runs,
  exactly one RuntimeSession, and one provider Agent. Ordinary same-chat
  continuity already works; restart reconstruction remains deferred.
- Paseo's useful pattern is simplified here: navigation selects a stable
  Session, live activity is the hot head, and persisted Run Events are the
  replayable tail.

## Product model

- A sidebar item is one ProductSession, not one Run or browser tab.
- A new user turn creates a new Task/Run inside the selected ProductSession.
- New Chat creates a distinct ProductSession using the fixed Web Workspace,
  AgentVersion, and EnvironmentVersion. RuntimeSession creation stays lazy until
  the first turn.
- Selecting a prior chat never resets, clones, or recreates it.
- New Chat and chat switching are disabled while the selected chat has an active
  turn. Background multi-chat streams are deferred.

## Public Session list contract

Add authenticated:

```http
GET /api/v1/sessions?limit=20&cursor=<opaque>
```

The query derives scope only from the authenticated service account and filters
by exact tenant, workspace, principal type, and principal ID. Browser fields
cannot choose or widen owner scope.

Response:

```json
{
  "sessions": [
    {
      "session_id": "uuid",
      "title": "bounded first user message",
      "preview": "bounded latest formal message",
      "preview_role": "assistant",
      "last_message_at": "ISO timestamp",
      "created_at": "ISO timestamp"
    }
  ],
  "next_cursor": null
}
```

- Default limit 20; maximum 50.
- Order by `COALESCE(last_message_at, session.created_at) DESC, session.id DESC`.
- Opaque keyset cursor contains only sort timestamp and Session ID.
- Invalid limit/cursor uses the existing safe error envelope.
- Title is the first formal User Message, whitespace-collapsed, controls removed,
  truncated to 60 Unicode code points. Empty Sessions use `New chat`.
- Preview is the latest formal User or Assistant Message, sanitized the same way
  and truncated to 120 code points; empty Sessions return `null`.
- Title and preview are plain text and never contain Markdown/HTML.
- The response excludes full messages, runtime/provider IDs, Tool activity,
  model configuration, and unbounded prompt text.
- No database migration, persisted title, generated summary, or search index.

## Same-origin BFF

- `GET /api/chats`: proxy the owner-scoped Session list with server-only bearer.
- `POST /api/chats`: reject unknown fields, create a ProductSession through the
  existing Session API, set the HttpOnly cookie, and return the empty chat.
- `POST /api/chats/{session_id}:select`: validate the ID, owner-read the Session,
  require the configured Web Workspace, read formal Messages, then update the
  cookie and return the selected chat.
- `GET /api/chats/{session_id}/runs/{run_id}/events`: require selected-cookie
  equality, prove the Run belongs to a formal Message in the Session, and page
  through the existing owner-scoped Run Event list.
- `GET /api/session`: recover the cookie when valid; otherwise select the most
  recent authorized Web Session; create one only when no Session exists.

The configured Web Workspace is dedicated to this local MVE. Cross-workspace or
foreign Sessions remain hidden.

## Sidebar and mobile navigation

- Desktop uses a 240–260px left navigation rail with Agent Server mark, New Chat,
  recent conversations, selected state, relative time, and Working/Completed/
  Failed indicator.
- The title and preview are rendered as plain text; ProductSession IDs remain in
  developer details only.
- Mobile uses an accessible drawer opened from the header. Selection closes the
  drawer; Escape/outside click close it and focus returns to the menu button.
- Header copy states `Same Agent · same runtime context` for the selected chat.

## Per-turn activity

Replace the page-global projection with:

```ts
Readonly<Record<runId, StreamProjection>>;
```

Group formal Messages by Task/Run into user/assistant turns. Each turn renders
its own Activity panel and Assistant Markdown response.

- The active turn's Activity is expanded and marked live.
- Reasoning progress, Tool state, nested subagent activity, usage, and read-only
  permission events update monotonically through the existing reducer.
- After the formal Assistant Message and terminal event converge, Activity
  collapses automatically but remains expandable.
- Refresh and chat selection page through persisted Run Events and reduce them
  with the same reducer. Completed Activity defaults collapsed.
- If replay is unavailable, show `Activity details are not available for this
turn`; never invent activity from answer text.
- Formal ProductSession Messages remain transcript truth.

### Paseo streaming parity

The Activity stream preserves the useful intermediate rendering exposed by
Paseo `v0.1.110`; a running animation is not a substitute for runtime data.
Live SSE and persisted replay reduce through the same ordered projection.

- `assistant_text` remains a cumulative, monotonic snapshot suitable for live
  Markdown rendering.
- `reasoning_progress` may include a cumulative sanitized text snapshot, not
  only `started`/`completed` state.
- `tool_status` may include a typed, bounded safe detail/result/error preview in
  addition to its label, summary, status, and parent activity reference.
- A direct child timeline may contain sanitized child assistant text, reasoning,
  and Tool rows. Arbitrary recursive descendants remain excluded.
- The adapter assigns opaque run-local item/activity IDs. Paseo provider,
  session, call, and child IDs never cross the runtime boundary.
- Stream order is the persisted Run Event order. Repeated snapshots update their
  existing item rather than creating visual duplicates.

Safe previews are projected per detail type at the Paseo adapter boundary:

- shell: screened command plus bounded output preview and safe exit status;
- read/write: workspace-relative path plus bounded textual content preview;
- edit: workspace-relative path plus bounded diff preview;
- search: screened query plus bounded result summary;
- fetch: sanitized HTTP(S) origin/path plus bounded textual result preview;
- Subagent: screened description plus direct child assistant/reasoning/Tool
  timeline items;
- failures: bounded sanitized error summary without raw provider errors.

All preview text removes control characters, is capped before persistence, and
passes credential screening. Absolute paths become workspace-relative or are
omitted. URLs lose credentials, query, and fragment. Unsafe content fails closed
to the existing generic label/summary.

### Same-daemon reference Web

Local Docker development uses one fixed Paseo daemon port for parity checks:

```text
container listen: 0.0.0.0:16767
host mapping:      127.0.0.1:16767:16767
Agent Server:      ws://127.0.0.1:16767/ws
Paseo Web:         ws://localhost:16767/ws
```

Non-Docker development keeps the current random loopback port. The fixed port
and non-loopback daemon listen are dev-only compose configuration and do not
change the production runtime contract.

### Tool and Subagent presentation

Paseo `v0.1.110` is the interaction reference. Ordinary Tool rows are collapsed
by default and show a meaningful, sanitized invocation summary. A Subagent Tool
row expands to a one-level read-only child Tool timeline built from Paseo's
provider-subagent list/timeline/update APIs and correlated by private
`toolCallId`.

The persisted Run Event remains a flat `tool_status` payload with an opaque
run-local `activity_id` and optional `parent_activity_id`. The Web reducer keeps
one flat activity map and derives root rows and child rows for rendering. This
supports live updates and refresh replay without storing a second mutable tree
or exposing provider IDs.

Allowed bounded display fields are:

- shell: a single-line command only when conservative credential screening
  passes;
- read/edit/write: a POSIX workspace-relative target only;
- search: a screened single-line query;
- fetch: HTTP(S) origin and path with credentials, query, and fragment removed;
- Subagent: screened type/title/description plus direct child Tool rows.

The browser never receives raw Tool/provider payloads, unbounded content,
absolute paths, cwd, provider/call/child IDs, child prompts, or unscreened
credentials. It may receive only the typed, bounded, sanitized timeline previews
defined above. Unsafe details fail closed to category-owned generic labels.

## Non-goals

- No database migration, editable/generated titles, search, delete/archive,
  rename, pinning, branching, or multi-device synchronization guarantees.
- No switching chats while a turn runs, background SSE ownership, or concurrent
  multi-chat controls.
- No raw or unbounded reasoning/Tool/provider payloads, absolute paths/cwd,
  provider IDs, child prompts, arbitrary recursive descendants, or interactive
  permission actions. Only the sanitized preview contract above is in scope.
- No old-session backend/Paseo restart recovery.
- No new automated test/evaluation/fixture suites.

## Acceptance

One real browser flow must prove:

1. existing chats appear after refresh;
2. New Chat creates and selects a distinct ProductSession;
3. selecting the original chat does not create another Session;
4. a fixed first-turn marker is recalled exactly in a later turn of that chat;
5. the chat still has exactly one RuntimeSession and provider Agent;
6. a real ordinary Tool shows a safe invocation summary and monotonic status;
7. a real Subagent appears dynamically and expands to direct child Tool rows
   with the same safe summaries;
8. completed Activity collapses, can be reopened, and survives refresh;
9. no token, raw provider/Tool data, absolute path, output/content/diff/result/
   log/error outside the bounded safe-preview contract, provider/child ID, child
   prompt, or unsafe command reaches browser evidence;
10. Paseo `v0.1.110` Web runs locally against the fixed Docker daemon port and
    can select the same provider Session used by Agent Server Web Chat;
11. a side-by-side real run shows equivalent intermediate assistant/reasoning/
    Tool lifecycle updates in both Web clients, allowing only the documented
    sanitization and product-layout differences;
12. terminal refresh replay reconstructs the same ordered sanitized timeline
    shown during the live run.
