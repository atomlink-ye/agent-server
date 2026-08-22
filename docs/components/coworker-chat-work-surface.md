# Coworker Chat / Work surface component

## Responsibility

The canonical Vite surface projects two sibling product views over Agent Server truth:

- **Conversations** — long-lived Direct Chat with a published Coworker;
- **Work** — durable Product Work and WorkRun inspection/execution.

The browser does not own Agent identity, Work state, service-account credentials, or runtime sessions. Browser-safe `/api/*` facades remain on Agent Server and forward to authenticated `/api/v1/*` contracts.

## Identity and navigation

A Direct Chat is addressable at `/conversations/:conversationId`. The in-memory AppStore mirrors the route; it is not the durable navigation source. The compatibility root `/` selects an available conversation and replaces the URL with the canonical deep-link.

When a Chat message carries a Work reference, `Open Work` navigates to:

```text
/work/:workId?from_conversation=:conversationId
```

The query value is intentionally URL state rather than React Router `location.state`. A reload therefore preserves the product relationship and `Respond in conversation` can return to `/conversations/:conversationId`.

## Convergence policy

The page uses bounded polling where durable server facts can change independently of a user click:

- conversation roster: 5 seconds while the Conversations tab is visible;
- selected transcript: 3 seconds while the Conversations tab is visible;
- Work Card: 3 seconds only while the Work is `running` or `needs_you`.

Visibility changes pause polling. Returning to a visible document performs an immediate refresh before normal polling resumes. Terminal Work Cards stop polling.

This is an MVE convergence policy, not a claim that polling is the V1 realtime transport.

## Coworker relationship convergence

`EnsureCoworkerConversation` owns the idempotent relationship write. `ReconcileCoworkerConversations` pages the published tenant-visible Coworker roster during resource-module startup and applies that seam for every enabled service account.

The reconciliation preserves the existing authorization boundary:

- Direct Chat is converged for a tenant-visible Coworker;
- Work entitlement is created only when the service account is the AgentDefinition owner and therefore the AgentDefinition workspace is unambiguous;
- cross-owner reconciliation never upgrades Work access.

Roster reads remain side-effect free. Startup reconciliation exists specifically to converge databases that contained published Coworkers before the publication hook was introduced.
