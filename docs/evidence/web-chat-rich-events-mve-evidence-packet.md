# Web Chat rich-events MVE evidence packet

**Date:** 2026-07-31
**Status:** Targeted secure same-session Paseo-parity acceptance, supported
checks, and Oracle merge-readiness approval recorded; Git/PR integration remains
the only operational gate

## Acceptance boundary

This packet records one sanitized Browser → same-origin Next.js BFF → Agent
Server → Paseo/OpenCode path using the supported Docker stack. The browser used
a fresh ProductSession and received only the HttpOnly `product_session_id`
cookie. The Agent Server bearer remained server-side. ProductSession Messages
remain the formal transcript truth; Run Events carry the transient rich
projection.

This is not production-readiness evidence. It does not establish OIDC, shared
ACLs, CSRF/CSP, rate limiting, secret brokering, production isolation,
multi-instance recovery, backpressure, retention, cancel UI, or old-session
restart recovery.

## Sanitized identifiers and runtime

- ProductSession: `6021d209-e92c-4360-bb6d-dec6b0d83342`
- Run: `42ab4ef5-cbeb-42c7-9e58-7377ce69e2e7`
- Model: `opencode/deepseek-v4-flash-free`

Prompts, assistant body text, marker values, credentials, provider IDs, local
paths, MCP headers, raw provider payloads, and generated runtime files are not
retained here.

## Fourth same-session Paseo comparison

Paseo source/reference was tag `v0.1.110`, commit
`5afc8b43f428f0ccc7f628814597d469300804ef`. Reference Web `:18081` and Agent
Server Web `:3001` used the same Docker Paseo daemon on `:16767`. The fourth
fresh mapping was ProductSession `78a38b55-d003-4667-af95-b6fa3b5a7704` →
RuntimeSession `bc056eda-f51d-4d33-a164-b27432212fe1` → workspace
`wks_8cf160c77c735480` → provider Agent
`319dcef1-9bff-4e48-873f-08c4bd89831c`, selected in Paseo with
`/?open=agent:<id>` after querying `runtime_sessions`.

Paseo showed and expanded Thinking, top-level Inspect entries, one subagent,
and `PARITY_FOUR_DONE`. Agent Server showed one cumulative Thinking disclosure,
one Subagent/Explorer parent disclosure, child Read/Shell, two child Thinking
segments, two child Assistant segments, and the same final response. Text
boundaries follow Tool boundaries; no per-token rows are claimed. Refresh
preserved two root rows, six child rows, and the final response; completed root
disclosures default closed and reopen normally.

Allowed differences are the ProductSession shell, Agent Server sanitization and
path redaction, and an inline read-only child timeline instead of Paseo's
dedicated child panel. A 390px scan found `scrollWidth=clientWidth=390`; root
rows were 356px, child rows 308px, and the composer remained visible.

The first and third fresh runs are not passing evidence: they exposed token
fragmentation and absolute-path sanitizer ordering bugs that were subsequently
fixed. Old persisted runs can contain pre-fix unsafe paths and must not be used
for current security claims.

## Latest targeted secure acceptance

A terminal-before long Run captured `Working` with cumulative expanded Thinking
and an expanded Explorer child timeline. The targeted ProductSession was
`335f93e4-b1d5-4141-8cea-034a06236ab6`, mapped through RuntimeSession
`2d0ee704-6e42-47ee-82c7-e3b8b3fc3961` to Paseo workspace
`wks_2348cba9a54db1d2` and provider Agent
`3c08685b-548c-4afb-b472-9670e704912c`; the final response marker was
`PARITY_SECURE_DONE`.

After exact CORS hardening, the actual same-provider Paseo page found and
expanded Thinking, Explorer, one subagent, and the same final response. The
fresh security scan found no absolute paths, runtime-cell paths, `ses_` IDs,
UUIDs, or long hashes; empty text disclosures were `0`. The CORS check allowed
the reference origin with `101` and rejected an untrusted origin with `403`.

## Browser observations

The page loaded and submitted successfully. The browser observed Working,
live assistant Markdown, a generic Reasoning/progress row, Tool activity,
Completed, a rendered Markdown `h2`, and refresh recovery. After refresh, the
same completed transcript was restored. The browser-visible surface contained
no service token: no browser Authorization header was observed, and the token
was absent from HTML, cookies, Local Storage, Session Storage, and fetched
bundles.

## Persisted Run Event observations

Database inspection found one successful Run, one User Message, and one formal
Assistant Message. The rich output sequence was:

| Sequence | Public observation                                                                     |
| -------- | -------------------------------------------------------------------------------------- |
| 1        | `started` lifecycle event                                                              |
| 2        | `reasoning_progress`, `started`                                                        |
| 3        | `reasoning_progress`, `completed`                                                      |
| 4        | `tool_status`, `running`, category `read`, opaque activity ID                          |
| 5        | `tool_status`, `completed`                                                             |
| 6–11     | six complete-so-far `assistant_text` snapshots, lengths 21, 72, 113, 140, 171, and 182 |
| 12       | final normalized `usage` snapshot                                                      |
| 13       | legacy final compatibility output                                                      |
| 14       | `succeeded` lifecycle event                                                            |

No raw reasoning text, Tool detail, Tool arguments/results, command, file or
path, URL, MCP data, credential, provider error, or provider payload was
retained. The read-only permission shape is part of the public contract but was
not emitted by this particular free-model session.

The parity browser scan found no `/workspace/.local/runtime-cells/`,
`/workspace/`, `provider_agent`, `childSession`, or `ses_` values. Sanitized
screenshots are retained in the active Playwright artifact directory:
`agent-parity-four-sanitized.png`, `paseo-parity-four-same-session-expanded.png`,
and `agent-parity-four-replay-mobile.png`.

## Public boundary proven by implementation

The outer Run Event types remain unchanged. Rich activity is flat scalar
`output.payload` data:

- `assistant_text` contains a complete-so-far Markdown snapshot and replaces
  prior transient text;
- `reasoning_progress` carries bounded sanitized cumulative `text` snapshots;
- `tool_status` exposes an opaque run-local `activity_id`, allowlisted category,
  monotonic status, fixed server-owned summary, and safe detail kind/text/exit
  code when available;
- `child_timeline_item` exposes only sanitized direct-child assistant,
  reasoning/Thinking, or Tool rows with bounded text/detail;
- `usage` is one final normalized telemetry snapshot with optional
  non-negative token/context numbers and no billing authority;
- `permission` is read-only activity with opaque activity ID, allowlisted
  category/status, optional allowed/denied decision, and fixed summary.

Unknown or malformed Paseo events are dropped. Provider, call, and child IDs
remain adapter internal; absolute paths, prompts, credentials, raw
chain-of-thought, and unbounded output are prohibited. Raw provider objects are
never recursively redacted or forwarded.

## Supporting validation

The latest supported checks used Node `24.18.0`, pnpm `11.7.0`, Paseo `0.1.110`,
and OpenCode `1.18.4`:

- `pnpm check`;
- root build;
- `NODE_ENV=production pnpm web:build`;
- `make paseo-smoke` with its success marker;
- `git diff --check`.

The first Web build inherited `NODE_ENV=development` and failed; the explicit
production-environment rerun passed. This was an environment/build invocation
difference, not a code defect. Oracle final merge review approved the complete
intended diff with no Critical or Important findings. Same-status Tool
detail/exitCode guards and quarantined-public-child terminalization with
semantic labels are included.

The mirror supply-chain policy passed 604 lockfile entries. The only finding
was the existing publication-time metadata caveat for
`sherpa-onnx-darwin-x64`; integrity remained enforced.

After a development restart, the page and favicon returned `200` with zero
console or HTTP errors. A transient favicon `500` during capture was diagnosed
as concurrent `next build` and `next dev` sharing generated `.next` state.
Stopping Web, deleting only generated `.next`, and restarting resolved it.
This is workflow evidence, not a product behavior claim. The stack was stopped
after final verification; no volume was deleted.

## Deferred limitations

- Large-history paging and retention/performance hardening.
- Session-list query N+1 optimization.
- ProductSession/Paseo restart reconstruction and old-session recovery.
- Conservative over-redaction improvements.
- Evaluation of an outer event wrapper beyond the flat `output.payload`
  boundary.
- Cancel UI and cross-backend or old-session restart recovery.
- Production identity, ACL, CSRF/CSP, rate limiting, secret broker, and
  deployment hardening.
- Multi-writer ordering, backpressure, retention, multi-instance operation,
  and production recovery.
- Broader console functionality, artifacts, citations, and richer provider
  details.

No ADR is required: this MVE does not select production identity, deployment,
recovery, or a new runtime architecture.
