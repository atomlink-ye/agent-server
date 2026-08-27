# Skill catalog API contract

The Skill catalog lists the Skills an author may attach to a Work Definition. It
exists to serve Work authoring, and nothing else: it is the set a Capability
builder offers, not a general-purpose registry browser.

All routes require an enabled service-account bearer token. The effective tenant
and principal come from authentication; callers cannot choose them.

## Availability

The catalog is installed by the same `productWorkSurface` fact that installs the
Work Definition routes, so it appears and disappears with Work authoring. Where
`AGENT_SERVER_PRODUCT_WORK_PLANE` is `absent` the route is never registered, and
the browser facade answers `503 feature_unavailable` rather than a bare `404`.
A 404 could not be told apart from a mistyped URL, which is why availability is
asserted from configuration at registration time and never inferred from an
upstream response.

## Routes

### `GET /api/v1/skills`

Lists every Skill published in this deployment's registry.

```json
{
  "skills": [
    {
      "ref": "agent-server/memory-api",
      "name": "agent-server/memory-api",
      "required_tool_refs": ["agent-server/memory-read"]
    }
  ]
}
```

`GET /api/skills` is the browser facade for the same resource. It forwards with
the server-side service credential and returns the identical body, so the
browser never holds a credential of its own.

## Errors

| Status | `error.code`          | When                                                                                                                                                                                                               |
| ------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `401`  | `unauthorized`        | The request carries no service-account bearer token, or one that is not enabled. Identical for a missing and a disabled token, so neither can be probed for the other.                                             |
| `503`  | `feature_unavailable` | The Product Work surface is not composed in this deployment, so the catalog was never installed. Returned by the browser facade before any upstream call. A retry cannot succeed, and a caller must not offer one. |

There is no per-item `404`: this route returns a collection, and an empty registry
is a successful empty list, not a missing resource. "You have nothing published"
is only ever claimed from a successful read.

Every error carries `error.code` and `error.request_id`. The `code` is the
discriminator callers match on; a client that drops it cannot tell a permanently
unavailable surface from a transient failure, and would offer a Retry that can
never succeed.

## What the shape deliberately omits

`ResolvedSkillPackage` also carries `digest`, `objectPath`, `manifestPath` and
`delivery`. None of them appear here. They describe how the registry stores a
Skill, which is not something an author choosing one needs, and exposing local
filesystem paths to a browser surface would be a leak rather than a feature.

## `required_tool_refs` is an authority statement

Attaching a Skill to a Work Definition also attaches the tools it names here.
Selecting a Skill is therefore transitively a capability grant, and a caller
that renders a picker must show what each Skill grants before it is chosen.

The Skill model carries no permission metadata, so nothing in this contract
widens `network` or `filesystem` permissions. A compiled Worker keeps
`network: read_only` and `filesystem: workspace_read` regardless of which Skills
are selected. Any per-Skill permission vocabulary would be a new contract and a
Human Gate, not an extension of this one.

## Divergence note

This catalog is an Agent Server extension. Cumora — the Coworker-identity
benchmark — has no Work authoring layer and no human-facing Skill selection at
any layer; its Skills are agent-scoped files an agent installs and reads through
its own CLI. This contract is a deliberate product decision, not Cumora parity.
