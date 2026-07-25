# Lark Managed Memory Card/Doc Canary Evidence

## Status and boundary

This packet records sanitized normal-path real-provider evidence for the fixed
compatibility canary. It does not claim canonical Lark identity, production
readiness, physical exactly-once delivery, multi-node leadership, or complete
crash recovery. Deferred hardening remains in the active Task 14 plan.

## Current implementation evidence boundary

The current same-session direct-Accept implementation creates the Bot-owned Doc
before the initial Card and uses `Open Doc`/`Accept`/`Reject`. The resumed Agent
fetch command uses the validated profile and `--as bot`; legacy edit/Preview
actions remain inbound-only. New deterministic E2E evidence is intentionally
pending and must not be inferred from the historical Preview flow below.

## Verified flow

- Source root: `om_x100b6977602948a8ddea65909e57918`
- Source Run: `5c345e5f-d44c-4a8e-a724-87664fc9657a`
- Card: `om_x100b69777cd89ca0dda56bf21cb4e06`
- Proposal: `394588c4-c082-475f-9123-82df0891fe76`
- Accepted Entry: `226fc70a-ff96-4d50-aa90-2fc9e190a771`
- Ready snapshot: `a9b9f81c-92f1-486b-8e00-4a66c8ba8a3b`, version `5`
- Ready content hash: `ac9b872b651eea7ba89609f39eeab01a55e2415fc3066fb4bc0b0f24ce675f92`
- Fresh recall root: `om_x100b697709ee58a0debf9efef9b405b`
- Fresh Agent reply: `om_x100b6977069294a4dd2da784dd83fc7`
- Fresh response: `RECALL_AGENT_OK LARK_REAL_CARDDOC_SOURCE_20260725_1150`

The source, edit, and accepted markers ending `20260725_1150` were present.
The source marker first appeared in snapshot version 5, establishing fresh-root
pin/recall of the accepted snapshot. Production `readDraft` independently
verified edited body plus one unresolved local comment and reply before Preview.

## Scope proven

The real provider normal path was: source root → source Run/long proposal → Bot
Doc and active Card → body edit plus unresolved comment/reply → Preview
generation → managed Agent synthesis → immutable Preview/hash → separate Preview
acceptance → one accepted Entry and ready snapshot → fresh root/session exact
snapshot pin → recall. This provider flow did not perform a later Doc edit after
Preview. The later-Doc-edit-is-ignored behavior is proven by the Task 12
deterministic real-PostgreSQL E2E, not by this provider packet.

The command path remains a fallback over the same canonical state. This packet
contains no credentials, raw events, raw comments/replies, action/callback
tokens, provider errors, local paths, or secret-bearing output.
