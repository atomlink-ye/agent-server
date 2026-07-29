# Managed Environment API

This is the narrow MVE-ENV1 Environment boundary. It is an authenticated,
owner-scoped registry for one fixed runtime package; it is not a general
environment marketplace or deployment API.

## Fixed package

The source is one bounded YAML document with this exact shape:

```yaml
apiVersion: agent-server/v1alpha1
kind: ManagedEnvironment
metadata:
  name: managed-environment-smoke
spec:
  adapter: paseo
  provider: opencode
  modelPolicyRef: free-only
  runtimeCellPolicy: per_runtime_session
```

Unknown fields and invalid values are rejected. The server canonicalizes the
package and returns a SHA-256 fingerprint. The package fixes Paseo/OpenCode,
the free-only model policy, and one Runtime Cell per RuntimeSession.

## Routes

All routes require an enabled service-account bearer. Tenant, principal, and
workspace scope come from authentication; callers cannot supply effective
ownership.

| Method | Path                                        | Success | Purpose                                           |
| ------ | ------------------------------------------- | ------- | ------------------------------------------------- |
| `POST` | `/api/v1/environment-packages:validate`     | `200`   | Read-only source validation and fingerprinting    |
| `POST` | `/api/v1/environments:import`               | `201`   | Idempotent owner-scoped definition/version import |
| `GET`  | `/api/v1/environment-versions/{id}`         | `200`   | Owner-scoped version read                         |
| `POST` | `/api/v1/environment-versions/{id}:publish` | `200`   | Idempotent draft-to-published transition          |

Import and publish require a non-empty `Idempotency-Key`; replaying the same
key and request is safe, while reusing a key for another request is
`409 idempotency_conflict`. Validation is read-only and does not require the
header. Published versions are immutable.

Responses contain only safe IDs, status, display name, fingerprint, timestamps,
and API links. Safe errors include `401 unauthorized`, `400 invalid_request`,
package validation codes, `404 environment_version_not_found`,
`400 invalid_idempotency_key`, and `409 idempotency_conflict`. Raw YAML,
prompts, provider errors, credentials, and local paths are not response or
normal-log fields.

## ProductSession pin and runtime semantics

`POST /api/v1/sessions` accepts optional `environment_version_id`. When present,
it must identify one published, owner-scoped EnvironmentVersion; the response
exposes the persisted `environment_version_id`. When omitted, creation succeeds
only if exactly one published owner EnvironmentVersion exists. There is no
unstable latest-version selection.

On first execution of a ProductSession, the application creates one immutable
SessionLaunchSnapshot and one internal RuntimeSession containing the resolved
Skill/tool references and the pinned EnvironmentVersion. The RuntimeSession is
unique to the ProductSession. Its derived Runtime Cell is
`<configured-cell-root>/<runtime-session-id>` and holds the native Skill
projection and scoped Skill/Grant receipts. Paseo opens one Workspace for that
cell; subsequent Runs in the same ProductSession continue the bound provider
Agent. A different ProductSession receives a different RuntimeSession, Cell,
Workspace, and provider Agent.

Existing `runtime_session_bindings` remain per-Run provenance. The RuntimeSession
and Cell are internal implementation semantics; no public RuntimeSession API is
claimed.

## Explicit non-goals

This MVE does not provide Environment list/update/delete/archive/default
administration, public RuntimeSession APIs, production isolation, Host
placement, quotas, leases, GC, restart reconstruction, crash recovery,
transaction-concurrency hardening, retry/reconciliation, a second adapter,
credential brokering, grant renewal, or a guarantee that provider systems do
not persist external MCP Authorization headers. Full Runtime Session V2,
production Tool Grant lifecycle, and legacy nullable-Session cleanup remain
deferred.
