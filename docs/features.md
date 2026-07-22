# Features

This is the authoritative capability ledger. Status values are `implemented`, `baseline`, `planned`, and `reserved`. `baseline` is a proven seam with known temporary limitations; it is not production completion.

| Feature area                     | Current status | Baseline evidence                                   | V1 destination                                                      |
| -------------------------------- | -------------- | --------------------------------------------------- | ------------------------------------------------------------------- |
| Identity and Access              | Planned        | Loopback-only warning                               | Tenant, canonical user, OIDC/Lark, ACL, service accounts            |
| Agents and Teams                 | Planned        | Runtime provider is hidden behind a port            | Immutable Agent/Team versions and bounded graphs                    |
| Workspace and Memory             | Baseline       | One isolated Paseo Workspace is explicitly reused   | Product Workspace, snapshots, proposals, memory policy              |
| Sessions, Tasks and Runs         | Baseline       | In-memory async Run state and polling               | Product Session, durable Task/Run, queue, lease, fence, recovery    |
| Runtime, Tools and Credentials   | Baseline       | Paseo/OpenCode adapter and zero-key model selection | Execution cells, tool gateway, credential broker, approvals         |
| Artifacts and Evidence           | Planned        | Result text only                                    | Immutable Artifact versions, evidence, source and child lineage     |
| Channels, API and Console        | Baseline       | Run and health HTTP routes                          | Task API, SSE, Web console, Lark adapter                            |
| Schedules, Triggers and Delivery | Planned        | None                                                | Idempotent admission, controlled schedules/events, durable delivery |

## Identity and Access

**Outcome:** one internal user and tenant authorization model across Web, API, Lark, OIDC, and service accounts.

**V1 acceptance:** external identities map to canonical users; membership and Workspace authorization are checked at admission and use; tenant storage isolation is tested; deprovisioning revokes future access; no caller may supply an effective principal. SAML/SCIM contracts may be reserved without claiming production support.

## Agents and Teams

**Outcome:** users publish reusable, immutable definitions instead of depending on an ad hoc runtime conversation.

**V1 acceptance:** Agent and Team share one Invokable contract; published versions are immutable; graph compilation validates references, schemas, reachability, bounds, completion, failure and capability attenuation; Team coordination never requires a shared Paseo session.

## Workspace and Memory

**Baseline:** the adapter opens one dedicated filesystem directory, assigns an explicit title, and reuses its Paseo Workspace ID. The smoke workspace is isolated and ignored by Git.

**V1 acceptance:** Product Workspace owns members, source snapshots, context, files, artifacts, and memory proposals. Leaf runs write only to their scoped scratch/candidate paths. Memory changes are proposals with source and authority, not silent prompt mutation.

## Sessions, Tasks and Runs

**Baseline:** `queued → running → succeeded|failed|timed_out` is stored in process memory. Create returns `202`; GET never returns the prompt. Restart loses all Runs.

**V1 acceptance:** Task is the only node invocation identity. Root/child admission and idempotency are durable. Run attempts use atomic claim, lease, activation, fence, typed completion, waiting/resume, cancel, retry, reconciliation, and immutable terminal history.

## Runtime, Tools and Credentials

**Baseline:** Paseo SDK calls are behind `AgentRuntimePort`; OpenCode models are discovered at startup; automatic selection is free-only; provider errors are normalized; caller model selection is forbidden.

**V1 acceptance:** dedicated execution placement, compatibility suite, normalized events, audience-bound capability tokens, credential-aware tool operations, approval policy, receipt-based side-effect recovery, and no raw business credential in a runtime-readable surface.

## Artifacts and Evidence

**V1 acceptance:** candidate, partial, and final outputs are immutable Artifact versions. Finalization creates a version rather than mutating a manifest. Evidence identifies source capture time and data-as-of. Root Team output retains child lineage across retries.

## Channels, API and Console

**Baseline:** health and minimal Run routes use common request IDs and error envelopes. A deterministic real-socket E2E covers the complete HTTP path.

**V1 acceptance:** Web/API/Lark normalize into one Task proposal and authorization path; Task trees and Run events are inspectable; no UI subscribes directly to Paseo; delivery is retryable and idempotent.

## Schedules, Triggers and Delivery

**V1 SHOULD:** a schedule fire or external event is persisted and deduplicated before Task materialization. A model may propose but cannot directly create a permanent schedule. When the feature is disabled, manual Task submission is the explicit fallback.
