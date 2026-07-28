---
status: approved
owner: orchestrator
created_at: 2026-07-28
updated_at: 2026-07-28
authority: design
---

# User-authored Skill pre-start registration

## Decision

The user approved a local project-directory registration flow as the next
`Prove` slice. A future authenticated Skill upload API will reuse the same
registration and immutable Registry service, but public upload, tenant storage,
and remote distribution are outside this slice.

Registration does not hot-reload an existing provider Agent. Updating a logical
Skill ref changes only provider Agents created after the update. Existing
provider Agents retain the immutable digest projected at creation time.

## Outcome

An operator can place an authored Skill beside an Agent definition, register the
project before creating a provider Agent, import and publish the Agent, and start
a Product Session whose OpenCode project discovers the Skill natively through a
Registry-backed symlink.

The current real canary stops after proving one pre-registered V1 Skill through
one newly created provider Agent. Ref updates across simultaneously retained old
and new provider Agents require isolated per-provider project directories and
are deferred by explicit user decision until after the main flow is proven.

## User project and logical references

The local project layout is:

```text
my-agent/
├── agent.yaml
└── skills/
    └── market-guide/
        ├── SKILL.md
        └── references/
```

The Agent package contains a logical ref, not a host path or Skill body:

```yaml
spec:
  skills:
    - ref: project/research-agent/market-guide
  tools: []
```

The local MVE command will be exposed as:

```bash
pnpm skill:register -- --project ./my-agent
```

The project slug and Skill directory name derive the logical ref:
`project/<project-slug>/<skill-name>`. The command reports each ref, digest, and
whether the current ref changed. Registering identical content is idempotent.

The command and Agent Server use the same configured Registry root. The local
default is under ignored `.local/` state; callers may set an explicit Registry
root without putting it in an Agent package or normal response.

## Registration architecture

A generalized registration service accepts a validated logical ref and source
directory. It enumerates regular files, validates the package, computes a
deterministic digest, writes an immutable object, and atomically updates a
logical ref manifest:

```text
<registry-root>/
├── objects/<digest>/...
└── refs/project/research-agent/market-guide.json
```

The service returns sanitized metadata only. The existing built-in Memory Skill
uses the same Registry implementation and remains fail-closed.

Application code resolves refs through a `SkillCatalogPort`. A resolved package
contains the logical ref, digest, manifest metadata, immutable object root,
delivery mode, and required Tool refs. It does not expose an arbitrary mutable
source directory to runtime code.

Future upload APIs may provide uploaded bytes or a staged directory to the same
registration service. They must add authentication, ownership, and durable
storage policy at their boundary rather than duplicating digest and Registry
logic. An upload boundary must first place untrusted bytes in server-controlled,
non-mutable staging and must not rely on the trusted-local-source assumption.

## Validation and atomicity

Local registration is an operator/admin pre-start operation over a trusted,
quiescent project directory. The source directory must not change during
registration. This Prove-stage MVE rejects symlinks, special files, executable
files, and observed path escapes in the stable source snapshot, but it does not
treat adversarial intermediate-directory replacement as an in-scope boundary.

Registration is single-writer per Registry root in this slice. Readers may
resolve concurrently, and ref publication is atomic for those readers, but
competing registration commands are not guaranteed serializable semantics.

Registration preserves the current Registry's bounded package limits and
rejects:

- a missing or non-root `SKILL.md`;
- malformed frontmatter or a name that differs from the Skill directory;
- invalid project slugs, Skill names, or logical refs;
- absolute paths, traversal, symlinks, executable files, and special files;
- packages that exceed file-count, per-file, or total-size limits;
- content or manifests whose digest does not match the immutable object.

All validation and object creation complete before the logical ref changes. A
failed update leaves the previous ref intact. Immutable objects and files are
read-only. Registration does not print Skill bodies or host paths in normal
output.

On Darwin, a filesystem permission fallback may transiently make a new digest
directory visible at `0755` before finalization. No logical ref is published to
that directory, and catalog resolution rejects it until the complete object is
verified at `0555`. This MVE therefore guarantees immutability before ref
reachability, not that every physically visible unreferenced digest path is
already immutable. Crash recovery for an unreferenced staging/orphan object is
deferred.

## Agent resolution and runtime binding

The managed Agent package parser continues to accept logical Skill refs. Skill
existence remains fail-closed before Paseo creates a provider Agent.

For a create operation:

1. Resolve every configured Skill ref against the current catalog.
2. Validate declared Tool refs against each Skill's required Tool refs.
3. Capture one immutable extension snapshot for the operation.
4. Pass that resolved snapshot to the Runtime extension binder.
5. Materialize a symlink in the isolated OpenCode project whose realpath is
   contained by the immutable Registry object root.
6. Record a sanitized receipt with schema format, ref, digest, and delivery mode.
7. Create the provider Agent through Paseo.

The isolated Runtime project is Agent Server-owned and quiescent while the
create-time projection runs. External concurrent mutation of its parent
directories is not a supported boundary in this MVE. The materializer still
rejects observed parent symlinks and requires an existing Skill target to be a
direct symlink to the expected immutable object rather than a transitive link.

Materialization happens before provider-Agent creation, so its receipt does not
claim a provider Agent ID that does not yet exist. Existing durable Run/provider
binding records and canary evidence correlate the completed create operation
with the provider Agent separately.

The binder consumes the resolved snapshot instead of resolving the mutable ref a
second time. This removes the registration/update race between resolution and
materialization.

For a continue execution operation, Agent Server reuses the existing provider
Agent and does not materialize or rebind Skills. Admission still resolves the
published Agent and its current logical refs before execution; a changed or
malformed ref can therefore reject a continuation before it reaches the reused
provider Agent. Removing that admission-time mutable-ref dependency is part of
the deferred V1→V2/session-isolation work.

## Deferred update semantics

Logical refs are mutable pointers to immutable objects:

```text
project/research-agent/market-guide → digest A
project/research-agent/market-guide → digest B
```

Re-registering different valid content atomically advances the Registry ref, but
the current shared provider project cannot safely host digest A and digest B at
the same logical projection path simultaneously. This slice therefore supports
registration before the first provider Agent starts and does not claim that a
new Session can adopt B while an old provider Agent continues on A.

The target future behavior is per-provider project isolation: existing provider
Agents retain symlinks to digest A and newly created provider Agents resolve
digest B. That functional extension and its cleanup/security hardening are not
acceptance blockers for the current main-flow proof.

Explicit immutable Skill-version references and requiring a new Agent version
for every Skill update are deferred product choices.

## Errors

The local command reports the implemented stable sanitized codes:

- `CLI_INVALID_ARGUMENTS`;
- `PROJECT_MISSING`;
- `PROJECT_INVALID`;
- `INVALID_AGENT_PACKAGE`;
- `PROJECT_REF_MISMATCH`;
- `MISSING_LOCAL_SKILL`;
- `MISMATCHED_LOCAL_SKILL`;
- `UNREFERENCED_LOCAL_SKILL`;
- `REGISTRY_FAILURE`.

An unknown or invalid ref prevents provider Agent creation before the Paseo
boundary. Errors do not include Skill bodies, credentials, or unmanaged host
paths.

## Real end-to-end canary

The canonical smoke will use fresh PostgreSQL, a disposable Registry and Runtime
root, real Agent import/publish and Product Session/Task/Run paths, Paseo, and an
OpenCode provider Agent.

### Register and run V1

1. Create an Agent project with a Skill-only marker
   `USER_AUTHORED_SKILL_V1_OK`.
2. Register it and capture digest A.
3. Import and publish the Agent package referencing the logical ref.
4. Create Session A and run one turn.
5. Assert the exact V1 marker, successful events, a symlink contained by object
   A, and a receipt for digest A.
6. Assert the marker is absent from the exact persisted provider system prompt
   and from the initial user prompt submitted to the API. Paseo 0.1.110 does not
   persist a separate initial-prompt field, so the canary does not claim one.

The canary output and evidence packet retain IDs, booleans, digests, event
sequences, and exact marker checks only. They do not retain prompts, Skill bodies,
bearers, provider error dumps, or host paths.

## Deferred work

- authenticated tenant Skill upload/list/version APIs;
- tenant ownership and cross-tenant authorization;
- database or object-storage metadata and remote distribution;
- deletion, retention, garbage collection, rollback, and explicit versions;
- signatures, review workflows, and malicious-content scanning;
- multi-node Registry synchronization and cache invalidation;
- running-session hot reload;
- isolated per-provider project directories and the V1→V2 old/new Session
  coexistence canary;
- automatic custom MCP Tool grants;
- renewal or session-lifetime alignment for the current five-minute in-process
  Runtime Tool Grant; longer-lived Tool sessions are hardening beyond the
  immediate two-turn canary;
- production resolution of Paseo's persisted MCP Authorization header.

## Success criteria

- The local command registers any valid project Skill through the generic
  Registry service without adding an arbitrary runtime registration API.
- A managed Agent can reference the registered logical ref and start through the
  real Agent Server → Paseo → OpenCode path.
- OpenCode discovers the Skill through the immutable symlink rather than prompt
  body injection.
- The canonical pre-start V1 canary and relevant repository checks pass, and all
  known non-blocking update/isolation and production work remains explicitly
  deferred.
