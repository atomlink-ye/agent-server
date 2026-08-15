# Users and journeys

## Researcher journey

```mermaid
journey
  title Enterprise research task
  section Prepare
    Sign in to tenant: 5: Researcher
    Open research workspace: 5: Researcher
    Select published agent or team: 4: Researcher
    Connect private source: 3: Researcher
  section Execute
    Submit research brief: 5: Researcher
    Inspect task tree and run state: 4: Researcher
    Approve sensitive operation: 3: Researcher
  section Deliver
    Review artifact and citations: 5: Researcher
    Accept memory proposal: 4: Researcher
    Continue in same workspace: 5: Researcher
```

Success means the accepted brief is never silently lost, the user can understand what version and authority executed it, and the result remains useful outside the chat transcript.

## Research lead journey

The lead drafts and publishes immutable Agent/Team versions, assigns them to workspaces, defines completion and failure policy, compares single-Agent and Team outcomes, and audits child work. A published version cannot be mutated under an existing Task. A retry keeps its history and identifies which child results were reused or regenerated.

## Platform administrator journey

The administrator connects identity providers, grants tenant/workspace roles, manages service accounts, configures isolation and credential providers, inspects audit trails, and drains unhealthy runtime pools. External identity identifiers never become business-object primary keys.

## Developer-platform journey

An internal service submits an idempotent Task proposal through the API and polls or subscribes to normalized events. It does not create Paseo sessions, choose worker activations, forge principals, or pass provider secrets. Lark and Web use the same Task admission contract.

In the current workspace-memory baseline, an authenticated service can also propose durable Workspace memory, attach optional Task/session provenance, review the proposal, and list accepted entries. This proves the governance loop only. The agent runtime does not retrieve those entries or receive them as injected context.

## Baseline developer journey

The current repository developer loop is pnpm-native and selects infrastructure explicitly:

1. `corepack enable && pnpm install --frozen-lockfile` installs repository dependencies.
2. `pnpm check` runs the deterministic repository/type boundary for ordinary development.
3. `pnpm local-env up core` starts PostgreSQL plus Agent Server without an execution plane.
4. `pnpm local-env up runtime` starts the current Paseo-backed runtime topology when execution is required.
5. `POST /api/v1/runs` remains a compatibility path that returns `202` and a stable Run URL; canonical product work uses Task admission.
6. Workspace-memory proposal routes create, review, and list accepted records under authenticated owner scope.
7. `pnpm smoke:runtime` is the explicit real-provider seam check and is not an ordinary deterministic prerequisite.

For focused infrastructure-backed verification, prefer a self-starting test or `pnpm local-env run <profile> -- <command>` over a scenario setup script. Generated diagnostics remain under ignored `.local/test-runs/` or CI artifacts.
