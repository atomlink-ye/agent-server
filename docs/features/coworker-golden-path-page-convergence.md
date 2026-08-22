# Coworker Golden Path page convergence

## Status

Baseline on `master@05f1ba42` after the Coworker Golden Path closure and N2 Chat wake work.

The 2026-08-22 status-probe archive was captured on `b2872919`. It remains useful regression evidence for the old raw-UUID picker, Agent Chat RuntimeSession UUID failure, and missing Work entitlement path, but those three blockers are not the current implementation state.

## Product outcome

The MVE product path is:

```text
Published Coworker
  -> Direct Chat
  -> natural-language discussion
  -> formal Work / WorkRun
  -> first-class Work Card in Chat
  -> terminal Work update
  -> return to the same Direct Chat
  -> follow-up / rework
```

The page-level invariant is that the user-visible identity and navigation survive ordinary refresh and that server state converges without a manual reload.

## Implemented behavior

- Published, chat-available AgentDefinitions are the Coworker roster.
- A Direct Chat uses the Coworker's display identity; the UI never asks for a raw AgentDefinition UUID.
- `/conversations/:conversationId` is the canonical Direct Chat deep-link. `/` is a compatibility entry that converges to the selected/first available conversation.
- Opening Work from Chat uses `/work/:workId?from_conversation=:conversationId` so a refresh does not lose the originating conversation.
- Returning from Work navigates to the canonical Direct Chat URL rather than transient router state.
- The conversation list refreshes while the Conversations surface is visible and refreshes immediately after visibility is restored.
- Opening the Coworker picker always reads a fresh roster. Selecting a Coworker with an existing Direct Chat opens it; otherwise the existing idempotent create path converges the relationship.
- Direct Chat search matches the same Coworker display name rendered in the list.
- A Work Card refreshes while its Work is `running` or `needs_you`, refreshes after visibility returns, and stops polling on terminal/unavailable state.
- Service startup reconciles already-published Coworkers for enabled service accounts, so databases created before the publication hook do not require a republish.
- Same-owner reconciliation restores the AgentDefinition workspace Work entitlement. Cross-owner Direct Chat is allowed by the current tenant-visible Coworker model but does not auto-grant Work context.

## Non-goals

This slice does not introduce a new runtime, WebSocket transport, generalized IAM, a new Work model, production retry/hardening, or a full frontend rewrite. It deliberately uses bounded polling over the existing APIs because the MVE objective is a reliable observable Golden Path, not a new realtime infrastructure layer.
