---
status: approved
owner: orchestrator
created_at: 2026-07-28
updated_at: 2026-07-28
authority: design
---

# Managed Environment and Runtime Session MVE

## Decision

The user approved the smallest complete `MVE-ENV1` implementation after PR #14.
This slice adds a Managed Environment API, pins one published EnvironmentVersion
to each ProductSession, and gives each ProductSession one durable RuntimeSession
with a deterministic private Runtime Cell directory and Paseo Workspace.

The stage is `Prove`. The acceptance authority is one real Agent Server → Paseo
0.1.110 → OpenCode 1.18.4 main flow. Security hardening, tenant administration,
runtime placement, recovery, concurrency, broad tests, and lifecycle completeness
are explicitly deferred.

## Outcome

An API caller can validate, import, read, and publish one Managed Environment,
create a ProductSession using that published EnvironmentVersion, and complete two
real turns on the same provider Agent. A second ProductSession using the same
AgentVersion and EnvironmentVersion receives a different RuntimeSession, Runtime
Cell directory, Paseo Workspace, and provider Agent.

The existing native Skill projection and read-only Agent Server MCP Tool continue
to work inside each cell. Skill bodies remain outside the native system prompt.

## Managed Environment package

The first package contains only the configuration already supported by the real
runtime path:

```yaml
apiVersion: agent-server/v1alpha1
kind: ManagedEnvironment
metadata:
  name: local-opencode
spec:
  adapter: paseo
  provider: opencode
  modelPolicyRef: free-only
  runtimeCellPolicy: per_runtime_session
```

All four `spec` values are fixed literals in this MVE. The package does not
support installation scripts, dependencies, images, arbitrary commands,
environment variables, credentials, network/filesystem policy, custom models,
remote hosts, or a second runtime adapter.

The parser follows the existing bounded Managed Agent YAML conventions: one safe
YAML document, strict keys, bounded source, canonical JSON, normalized name, and
SHA-256 fingerprint. It may reuse small parser utilities but must not duplicate
the complete Managed Agent compiler where Environment has no corresponding
behavior.

## API contract

The authenticated public surface is:

```text
POST /api/v1/environment-packages:validate
POST /api/v1/environments:import
GET  /api/v1/environment-versions/{version_id}
POST /api/v1/environment-versions/{version_id}:publish
```

Validate and import accept exactly:

```json
{ "source": "<ManagedEnvironment YAML>" }
```

Import and publish use the existing `Idempotency-Key` rules and safe error
envelope. Validate is read-only and key-free. Import returns the definition and
draft version; publish is an immutable one-way transition. Missing and foreign
versions use one safe not-found response. The MVE does not add list, definition
read, update, delete, archive, latest-version, or public RuntimeSession APIs.

Environment ownership follows the existing Managed Agent owner tuple for minimum
integration consistency. This is reuse of the current service-account boundary,
not a claim of complete tenant or shared-ACL design.

## Session API change

`POST /api/v1/sessions` accepts:

```json
{
  "workspace_id": "...",
  "agent_version_id": "...",
  "environment_version_id": "..."
}
```

`environment_version_id` is optional only as a narrow compatibility convenience:

- when supplied, it must resolve to one published EnvironmentVersion in the
  authenticated owner scope;
- when omitted and exactly one published EnvironmentVersion exists for that
  owner, that version is selected;
- when omitted with zero or multiple published versions, creation fails with a
  safe `environment_required` error.

The selected EnvironmentVersion ID is persisted on ProductSession and returned
by Session reads. There is no implicit latest version and an existing Session
never changes EnvironmentVersion after publication of another version.

## Durable model

### EnvironmentDefinition and EnvironmentVersion

`EnvironmentDefinition` contains stable owner-scoped identity, normalized name,
display name, and timestamps. `EnvironmentVersion` contains definition identity,
owner scope, `draft | published` status, fingerprint, canonical package JSON,
timestamps, and optional publication time.

Fixed capability fields remain in canonical package JSON rather than being
duplicated as independently mutable columns.

### SessionLaunchSnapshot

The first successful turn fixes the actual launch combination:

```ts
type SessionLaunchSnapshot = {
  id: string;
  agentVersionId: string;
  environmentVersionId: string;
  resolvedSkills: Array<{ ref: string; digest: string }>;
  toolRefs: string[];
  createdAt: Date;
};
```

Memory snapshot identity is intentionally omitted. Current memory selection is
pinned on the existing Task/turn path, and this Environment slice does not change
that contract.

### RuntimeSession

One ProductSession owns one RuntimeSession in this slice:

```ts
type RuntimeSession = {
  id: string;
  scopeKind: 'product_session';
  scopeId: string;
  launchSnapshotId: string;
  paseoWorkspaceId?: string;
  providerAgentId?: string;
  createdAt: Date;
  updatedAt: Date;
};
```

The database enforces one RuntimeSession per `(scope_kind, scope_id)`. The schema
may reserve `task` as a future scope value only if doing so does not add unused
runtime behavior.

### Runtime Cell and binding simplification

Runtime Cell is a deterministic filesystem allocation, not a public resource or
database table:

```text
runtimeCellId   = runtimeSessionId
runtimeCellPath = <configured runtime-cell root>/<runtimeSessionId>
```

The RuntimeSession row stores the physical Paseo Workspace and provider Agent
binding. The existing per-Run `runtime_session_bindings` table remains unchanged
for Run/channel provenance and compatibility; continuation no longer infers the
canonical ProductSession binding from the latest Run.

## Execution flow

### First turn

1. Load ProductSession and its pinned published AgentVersion and
   EnvironmentVersion.
2. Resolve immutable Skill refs/digests and supported Tool refs.
3. Create one immutable SessionLaunchSnapshot and one RuntimeSession.
4. Derive and create the Runtime Cell directory from RuntimeSession ID.
5. Project the resolved Skills and MCP binding into that cell.
6. Ask the Paseo adapter to open a Workspace whose CWD is that cell.
7. Create one real OpenCode provider Agent.
8. Persist Paseo Workspace ID and provider Agent ID on RuntimeSession.
9. Continue writing the existing per-Run binding and lifecycle evidence.
10. Return the real Agent result through the existing Task/Run/Message path.

### Later turns

The application loads RuntimeSession by ProductSession ID and continues its
persisted provider Agent. It sends only the current turn, does not repeat native
Bootstrap, and does not rebind or rematerialize extensions.

### Second ProductSession

The same AgentVersion and EnvironmentVersion may be reused, but the second
ProductSession receives a separate RuntimeSession ID, cell directory, Paseo
Workspace, provider Agent, extension materialization, and Tool Grant.

## Runtime port boundary

`AgentRuntimePort.execute(create | continue)` remains the compatibility facade.
The create input gains provider-neutral runtime-cell context and the resolved
extension snapshot. Create output exposes the safe Paseo Workspace ID needed for
the durable RuntimeSession binding. The continuation input uses the persisted
provider Agent ID and does not require a new adapter framework or runtime factory.

Paseo remains behind the application port. Domain and application modules do not
import Paseo or OpenCode types.

Environment is authoritative for adapter, provider, model policy, and cell
policy. Existing Managed Agent runtime/provider fields remain compatibility
metadata for this MVE; their cleanup or deprecation is deferred.

## Blocker-now classification

The slice must fix only failures that prevent or invalidate:

- Environment validation/import/read/publication;
- published Environment pinning on ProductSession;
- durable launch snapshot and RuntimeSession creation;
- deterministic per-session Runtime Cell allocation;
- Skill/MCP binding inside the selected cell;
- a distinct Paseo Workspace per ProductSession;
- direct continuation from RuntimeSession;
- existing per-Run provenance;
- truthful real Paseo/OpenCode output.

## Real main-flow smoke

The canonical command is:

```bash
pnpm smoke:managed-environment
```

The smoke uses fresh PostgreSQL plus disposable Registry and Runtime roots:

1. Import and publish a Managed Agent using the existing native Skill and
   read-only Memory MCP Tool.
2. Validate, import, read, and publish a Managed Environment.
3. Create ProductSession A with the published EnvironmentVersion.
4. Turn A1 reads an exact marker through the real Skill/MCP boundary.
5. Turn A2 reads it again through the same provider Agent.
6. Create ProductSession B with the same Agent and Environment.
7. Turn B1 reads the marker through a second real provider Agent.
8. Inspect durable and filesystem evidence.

Acceptance requires:

- one launch snapshot and RuntimeSession per ProductSession;
- A1 and A2 share one non-null provider Agent ID and Paseo Workspace ID;
- A and B have different RuntimeSession IDs, cell directories, Paseo Workspace
  IDs, and provider Agent IDs;
- each cell contains the expected immutable Skill projection and sanitized
  extension receipts;
- all three Runs complete through real Paseo/OpenCode and return the expected
  marker;
- the marker is absent from submitted user prompts and the full Skill body is
  absent from native system prompts;
- no bearer, raw prompt, Skill body, provider error dump, or host path enters the
  retained sanitized evidence.

The smoke is the primary evidence. Existing checks may run afterward as
supporting signals, but this MVE does not proactively add unit, contract,
integration, deterministic E2E, evaluation, or fixture suites. This is an
explicit implementation-stage deferral of the repository's ordinary public
contract-test expectation, approved for the current MVE.

## Deferred work

- Environment list, definition read, update, delete, archive, rollback, latest,
  default-resource administration, and UI;
- shared Tenant Environment resources, ACLs, OIDC, and production authorization;
- environment variables, secrets, install scripts, dependencies, images,
  sandbox, network/filesystem policies, capability negotiation, and provider
  profiles;
- RuntimeSession public create/resume/status/close APIs;
- Runtime Cell table, Host registry, placement, leases, quotas, GC, remote hosts,
  Windows, and a second Runtime adapter;
- concurrent first-turn creation, provider-create/binding crash recovery,
  restart reconstruction, reset/rebind, retry, reconciliation, and multi-node
  behavior;
- Tool Grant renewal and production resolution of Paseo's persisted external MCP
  Authorization header;
- Environment/Agent compatibility migration and removal of legacy Agent runtime
  metadata;
- Team Child RuntimeSessions, parallel DAG execution, wait/resume, schedules,
  performance, broad tests, and production operations.

## Success criteria

- The four Environment endpoints operate through the real authenticated API.
- Every created ProductSession pins one published EnvironmentVersion.
- ProductSession A completes two real turns on one RuntimeSession/provider Agent.
- ProductSession B completes a real turn in a different cell and Paseo Workspace.
- Existing Skill and MCP behavior remains native and works in both cells.
- The canonical smoke records sanitized, reproducible evidence and all
  non-blocking work remains explicitly deferred.
