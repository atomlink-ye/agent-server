# Requirements and release scope

## Classification

Every capability is classified as `baseline`, `V1_MUST`, `V1_SHOULD`, `V1_RESERVED`, or `POST_V1`. `implemented` means code plus acceptance evidence exists in this repository; prose alone never changes status.

## Walking-skeleton acceptance

- A new clone installs on supported Linux/macOS x64/arm64 platforms.
- `make ci` passes without a daemon, network model request, or credential.
- `POST /api/v1/runs` validates a prompt, refuses model selection, returns `202`, and exposes a pollable resource.
- Runtime unavailable returns `503` before work is accepted.
- Paseo is accessible only behind `AgentRuntimePort`.
- One explicit Workspace is initialized and reused.
- Automatic catalog selection chooses only an explicitly free model.
- Real external smoke returns the exact marker and cleans its managed processes.
- Product, feature, component, contract, quality, operations, ADR, and agent-workflow documents are internally linked and offline-readable.
- Phase E minimum: an accepted Product Workspace entry can be rendered into a verified immutable local `MEMORY.md`/manifest snapshot, read through authenticated routes, and rebuilt with a stable content hash; local paths are never public.

## V1 reliability requirements

- Accepted ingress is materialized before queue publication and is idempotent.
- Task is the only invocation identity; a retry creates a new Run attempt under it.
- Claims are atomic, activations are unpredictable, fences increase, and stale writers fail closed.
- Waiting for children or approval releases worker authority and resumes through a new activation.
- Terminal Run history and Artifact manifests are immutable.
- Cancellation, retry, reconciliation, and unknown-side-effect handling converge explicitly.
- Team depth, fan-out, concurrency, review iterations, and budget are bounded.
- Child capabilities can only be equal to or narrower than the parent.
- Root artifacts preserve child Artifact, Evidence, Source, Version, Task, and Run lineage.

## V1 security requirements

- Every resource is tenant-scoped and protected by canonical authorization and storage isolation.
- User/business credentials remain in a broker or upstream authorization server.
- Runtime provider infrastructure credentials are separately controlled and never exposed through prompt, tools, workspace, or ordinary shell.
- High-risk or non-repeatable operations resolve to deny, durable approval, or narrower scope.
- Logs, events, tool results, and API errors are secret-safe.

## Release gates

Single-Agent Core is an internal milestone. V1 Beta additionally requires Team sequential, parallel-plus-join, and human-approval scenarios; contract equality between Agent and Team nodes; bounded depth/fan-out; fail-closed lease behavior; root cancel/retry/budget/trace propagation; and complete root Artifact lineage.

Manager-worker, review loop, schedule, and event-trigger features remain `V1_SHOULD`: when absent, the platform must expose their documented fallback rather than silently weakening a Beta gate.
