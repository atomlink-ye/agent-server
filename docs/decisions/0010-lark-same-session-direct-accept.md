# ADR 0010: Lark same-session direct Doc Accept

## Status

Accepted for the fixed compatibility canary; not production readiness. This
supersedes the interaction portion of ADR 0009 while preserving its Preview
history.

## Decision

The fixed chat keeps one origin/thread-scoped Product Session and reuses its
bound provider Agent for successive Runs. Each successful Lark Memory proposal
immediately creates a Bot-owned editable Doc before publishing `card_with_doc`.
The initial Card renders only `Open Doc`, `Accept`, and `Reject`.

Direct Accept resumes the exact source Run+Session provider binding. The Agent
must fetch only the bound Doc with
`lark-cli docs +fetch --profile <validated-profile> --as bot --doc <token>`, then
return exactly one controlled candidate. Doc content is untrusted; the Agent
does not mutate Memory or accept Cards. Agent Server validates and owns
`edit_and_accept`, Entry creation, ready Snapshot projection, and outbox delivery.

Legacy `edit_in_doc`, `preview_doc`, and `accept_preview` remain inbound-only for
already-issued Cards. Terminal provenance uses the creating ingress kind: source
message root for immediate surfaces, Card message for legacy Card-action Preview
successors.

## Consequences and non-goals

Missing/wrong bindings fail closed; no provider replacement, scope broadening,
auth flow, credential change, schema migration, or Task 14 hardening is added.
Deterministic E2E and real canary evidence remain follow-up work.
