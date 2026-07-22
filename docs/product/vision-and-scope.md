# Vision and scope

## Vision

Enterprise teams should be able to configure a long-lived Agent or bounded Team once, invoke it from existing work channels, safely use private data, recover work across runtime failures, and receive a reviewable artifact with evidence. Runtime choice must not redefine the product or leak into every feature.

## Primary users

- Researchers and analysts who combine internal sources with external information and need formal deliverables.
- Research leads who reuse Agent/Team versions, inspect nested progress, and control data and credentials.
- Platform administrators who manage tenants, identity, service accounts, audit, and isolation.
- Internal developer-platform teams that need one API and channel contract instead of provider-specific integrations.

## V1 outcome

A user creates a Research Workspace, selects a published Agent or Team version, connects a permitted data-source credential, submits a brief through Web, API, or Lark, observes durable Task/Run progress and approvals, and receives an Artifact whose source and child lineage are preserved.

## V1 MUST boundary

- Canonical tenant/user identity with OIDC, membership, Lark binding, Workspace ACL, and service accounts.
- Credential vault/broker, user-private credentials, credential-aware tools, and approval policy.
- Long-lived Agent identity with immutable versions.
- Immutable Team versions and statically validated bounded graphs.
- Sequential execution, parallel-plus-join, human approval, and maximum nesting depth two.
- Research Workspace, sources, context, files, memory proposals, and immutable artifacts/evidence.
- Product Session, canonical Task, Run attempts, durable queue, typed completion, cancel/retry, reconciliation, and audit.
- Paseo leaf-runtime adapter, isolated execution placement, normalized events, and compatibility tests.
- Web, API, and Lark entrypoints sharing one admission path.

## V1 SHOULD boundary

Manager-worker delegation, bounded review loops, schedules, event triggers, agent-level memory suggestions, URL snapshots, richer PDF output, shared tenant credentials, full distributed traces, and advanced authoring UI are target capabilities with explicit fallback controls. Their absence must not be disguised as partial completion.

## Explicit non-goals

- Unbounded recursive spawn, runtime mutation of published graphs, free-form Agent group chat, or a shared mutable Team scratchpad.
- A general workflow canvas, Team marketplace, cross-tenant teams, or automatic multi-runtime routing.
- Models directly creating permanent schedules or expanding their own credential scope.
- Coding pull-request automation or high-risk financial execution as the initial product.
- Production claims based on the walking skeleton.

See [Requirements and release scope](requirements-and-release-scope.md) for baseline versus V1 acceptance.
