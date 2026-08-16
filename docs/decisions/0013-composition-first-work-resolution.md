# Composition-first Work resolution

Status: Accepted for the MVE implementation on `feat/composition-first-framework`.

## Decision

Product `Work` and `WorkRun` resolve author intent through one side-effect-free
`WorkDefinitionResolutionPort` before technical Task admission. The resolved
shape pins immutable participants, resource references, platform capabilities,
and execution/session policy. A Work may currently resolve to either:

- one published ManagedAgent (`single_agent`); or
- one published fixed-roster Team (`collaboration`).

The existing Agent/Environment/Team registries remain storage and deployment
mechanisms. They are not elevated into new product objects. `TeamRun`, Task,
technical Run and RuntimeSession remain internal execution identities.

Platform Collaboration is context-derived and is not a user/domain tool. The
resolved model records the required platform capability while PR71 owns its
runtime MCP mounting and call-time authorization.

Each bound WorkRun records an immutable resolved-resource manifest. A newer
Agent/Environment/Team publication must not change an existing WorkRun's
resource snapshot. The MVE keeps existing execution drivers: single-agent Work
admits an Agent Task; collaborative Work admits a Team Task.

## Runtime policy

The MVE makes existing behavior explicit rather than introducing a new session
scheduler:

- single-agent Work: `fresh` RuntimeSession + `run_scoped` RuntimeWorkspace;
- collaborative Work: `reusable` participant RuntimeSessions +
  `work_run_scoped` RuntimeWorkspace.

Required execution-plane capabilities are checked before root admission. Paseo
is the only current execution plane and advertises the existing MVE capability
set plus `platform_mcp`.

## Deliberate limits

This decision does not add a generic DAG DSL, nested/dynamic Teams, a runtime
plugin marketplace, a second execution plane, generalized placement, or
production recovery. It also does not replace the accepted Product API or make
technical identities user-facing.
