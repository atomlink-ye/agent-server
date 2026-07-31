# Web Chat + Paseo Streaming MVE evidence packet

**Date:** 2026-07-31
**Status:** Fresh-session local MVE evidence approved; production hardening deferred

## Acceptance boundary

This packet records one sanitized Browser → same-origin Web BFF → Agent Server
→ Paseo/OpenCode path. The browser used a fresh ProductSession and received
only the HttpOnly `product_session_id` cookie. The Agent Server bearer remained
server-side. Persisted ProductSession Messages were the conversation truth;
Run Events were the transient assistant-text projection.

This is not production-readiness evidence. It does not establish OIDC, shared
ACLs, CSRF/CSP, rate limiting, secret brokering, production isolation,
multi-instance recovery, backpressure, retention, or rich runtime event
projection.

## Sanitized identifiers

- ProductSession: `f9242577-aab9-4f03-b983-17d7d5316b93`
- User Message: `4d79eb83-a7ca-4415-8832-4696b62bb862`
- Task: `b4ff72b3-0597-4c75-b679-1b8f9cfce440`
- Run: `9ea0dc45-c196-4976-b654-76d06312e91a`

These identifiers are retained only to correlate the sanitized acceptance
observations. Prompts, assistant body text, marker values, credentials,
provider errors, local paths, MCP headers, and generated runtime files are not
retained here.

## Browser and stream observations

The browser message submission returned `202`. The observed persisted Run Event
sequence was:

| Sequence | Kind        | Sanitized observation                         |
| -------- | ----------- | --------------------------------------------- |
| 1        | `started`   | Run admitted and started                      |
| 2        | `output`    | `assistant_text` snapshot, length 7           |
| 3        | `output`    | `assistant_text` complete snapshot, length 25 |
| 4        | `output`    | final compatibility output, length 25         |
| 5        | `succeeded` | persisted terminal event                      |

The sequence-3 assistant snapshot was observed at approximately 7889.2 ms.
Before sequence 5 at approximately 7889.6 ms, the DOM still showed the
complete transient assistant snapshot while status remained `running`. The UI
then became `completed`; one formal Assistant Message replaced the transient
content.

The BFF forwarded the upstream SSE response without parsing or buffering and
honored `after` and `Last-Event-ID`. The browser used native EventSource. A
pre-terminal disconnect is covered by the existing polling fallback; stale SSE
and polling callbacks are identity-guarded.

## Persistence and reload evidence

Database inspection confirmed:

- the Run succeeded;
- exactly one User Message and one Assistant Message existed for the Task;
- the Assistant Message matched the final assistant result;
- Run Events contained a partial complete-so-far snapshot followed by the full
  accumulated snapshot;
- browser reload restored completed status, one Assistant Message, and the same
  final assistant result.

The earlier partial-snapshot behavior exposed the chunk-as-snapshot bug. The
Paseo adapter was corrected to accumulate live chunks per epoch while treating
projected Timeline entries as complete authoritative snapshots. Oracle reviews
of the backend and Web paths subsequently returned `SPEC_COMPLIANT` and
`QUALITY_APPROVED`.

## Browser secret-boundary checks

Checks were false for Authorization request headers and the configured service
token in request headers, cookie values, HTML, Local Storage, Session Storage,
and fetched client JavaScript bundles. The only observed cookie name was
`product_session_id`.

## Reproduction and supporting observations

The local path was bootstrapped through the existing authenticated APIs and
started with the documented `web-bootstrap` and `web-dev` commands. Fresh
supporting checks recorded for this packet were:

- `pnpm web:check:types`: passed.
- `pnpm web:build`: passed; Next.js production build completed.
- Default-registry `make check`: did not reach project checks because npm
  metadata requests repeatedly timed out; no lockfile or policy change was
  made.
- One-shot mainland-China override
  `PNPM_CONFIG_REGISTRY=https://registry.npmmirror.com ./scripts/dev/docker-run
--pass-env PNPM_CONFIG_REGISTRY -- pnpm check`: passed lockfile
  supply-chain policy for 506 entries in 10.4s, root typecheck, Prettier,
  documentation checks for 112 Markdown files, and Exec Plan checks for 30
  plans with 6/6 test cases.
- The same one-shot registry override with `pnpm build`: passed root TypeScript
  build and lockfile policy for 506 entries in 10.7s.
- `pnpm exec prettier --check .`, `docker compose config --quiet`, and
  `git diff --check`: passed.

Mirror metadata had publication times for the probed `@opencode-ai/sdk`
version. During install it lacked `time` only for `sherpa-onnx-darwin-x64`, so
pnpm skipped `minimumReleaseAge` for that package under the existing default
policy. Integrity and all other existing policies remained active. This is a
registry metadata caveat, not a code or policy failure. The regional registry
was used only as a one-shot environment override and was not committed.

## Deferred limitations

- Old ProductSession continuation after Agent Server/Paseo restart can fail
  because a persisted Paseo Agent may reference a stale Runtime MCP endpoint.
- Production identity, ACL, CSRF/CSP, rate limiting, and secret broker remain
  deferred.
- Reconnect/recovery guarantees, multi-writer ordering, backpressure,
  retention, and multi-instance operation remain deferred.
- Reasoning, tool, permission, usage, cancel, and other rich runtime events are
  not projected by this MVE.
- Broader console functionality remains deferred.

No ADR is required: this MVE does not select a production identity,
deployment, recovery, or multi-runtime architecture.
