---
status: completed
owner: orchestrator
created_at: 2026-07-31
updated_at: 2026-07-31
authority: design-spec
---

# Web Chat Rich Events MVE Spec

## Outcome

Turn the merged Web Chat streaming proof into a visually complete internal Chat
surface that can carry one real Managed Agent conversation. The browser shows
safe Markdown, complete-so-far assistant snapshots, normalized Reasoning
progress, Tool status, usage, and read-only permission activity while durable
ProductSession Messages remain the formal transcript.

## Approved product direction

The visual direction is **Quiet Control Room leaning toward Focused
Conversation**: the conversation and final answer dominate; runtime activity is
compact, calm, collapsible, and secondary. The user approved new Web
dependencies, Markdown rendering, and a richer public Run Event payload. Cancel
and cross-backend-restart recovery are deferred.

## Main flow

```text
Browser -> Next.js BFF -> ProductSession Message -> Task/Run
-> real Paseo/OpenCode -> normalized safe runtime events
-> append-only Run Events/SSE -> Web activity projection
-> terminal -> durable Assistant Message -> refresh recovery
```

## Public event contract

The existing outer Run Event types and PostgreSQL schema remain unchanged.
Rich activity uses flat scalar `output.payload` variants:

- `assistant_text`: `text` is a complete-so-far Markdown snapshot and replaces
  prior transient text.
- `reasoning_progress`: `status=started|completed`; no raw chain-of-thought or
  provider reasoning text is exposed.
- `tool_status`: opaque run-local `activity_id`, allowlisted `category`,
  `status`, and a server-owned fixed `summary` only.
- `usage`: optional non-negative normalized token/context/cost numbers; at most
  one final snapshot and not billing authority.
- `permission`: opaque activity ID, category, requested/resolved status,
  optional allowed/denied decision, and fixed read-only summary.
- legacy `{ text }` final compatibility output remains readable but ignored by
  the rich Web reducer.

Outer `started|succeeded|failed|cancelled` events remain lifecycle authority.
PostgreSQL Run Event sequence remains the only public ordering and SSE cursor.

## Redaction and security boundary

Construct normalized events from an allowlist; never recursively redact or
forward a provider object. Exclude tool arguments/results, commands, shell
output, file content/names/paths, diffs, URLs, search queries/results, MCP data,
provider IDs, raw permission requests, credentials, provider errors, and raw
reasoning text. Unknown or malformed Paseo events are dropped without raw logs.

## Runtime reconciliation

- Subscribe before the turn and filter by the active provider Agent.
- Keep Paseo epoch, sequence, call IDs, and permission request IDs private.
- Assistant snapshots replace; Tool and permission state may only move forward.
- Projected Timeline catch-up is authoritative for missing assistant and Tool
  items after the active turn.
- Serialize sink writes and drain them before execution returns.
- Append only when the normalized public semantic value changed.

## Web design

- One warm, quiet application shell with a compact Agent identity rail on wide
  screens and a single-column mobile layout.
- Conversation is primary; runtime activity appears directly above the current
  assistant response as compact collapsible rows.
- Assistant transient and formal text use the same safe Markdown renderer.
- User text remains plain text.
- Reasoning is a generic Progress row, not a claim to reveal private thought.
- Tool rows show category, fixed summary, and state only.
- Permission activity is read-only and explicitly says controls are unavailable.
- Usage and IDs live in secondary details rather than the main reading flow.
- Loading, empty, disconnect, send failure, runtime failure, and completed
  states use grounded product copy.

## Markdown boundary

Use `react-markdown`, `remark-gfm`, and `rehype-sanitize`. Do not enable raw HTML
or `rehype-raw`. Disable images, restrict links to safe protocols, and add
`rel="noopener noreferrer"`. Syntax-highlighting plugins are deferred.

## Non-goals

- Cancel UI, reset UI, old-session restart recovery, and production recovery.
- Raw reasoning text or provider-native event passthrough.
- Tool detail, permission responses, files, artifacts, citations, or traces.
- OIDC, ACL, CSRF/CSP suite, public deployment, multi-instance projection,
  retention, backpressure, DLP framework, or browser matrix.
- New unit, integration, contract, deterministic E2E, evaluation, or fixture
  suites.

## Acceptance

One real browser Session must show a durable User Message, real Paseo/OpenCode
execution, at least one rich Progress or Tool activity event, live assistant
Markdown before terminal, terminal convergence to one formal Assistant Message,
and the same transcript after refresh. Browser-visible surfaces must contain no
service token or prohibited runtime data.

## Observed MVE evidence

The completed real-session evidence is recorded in
[`docs/evidence/web-chat-rich-events-mve-evidence-packet.md`](../../evidence/web-chat-rich-events-mve-evidence-packet.md).
It covers the fresh browser path, live Markdown, progress and Tool activity,
final usage, terminal convergence, refresh recovery, and the browser secret
boundary. The evidence is sanitized and retains no prompt or assistant body.
The active plan remains open for final independent review; this spec is not yet
archived as completed.
