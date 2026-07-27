# Managed Single-Agent V1 Runbook

Status: **FINAL MINIMUM-SCENARIO RUNBOOK — production hardening deferred**

This runbook describes the narrow A–H managed single-agent evidence boundary.
It is not a production-readiness approval. Public responses and evidence must
remain free of prompts, YAML, credentials, local paths, raw provider errors,
and raw owner/resource identifiers.

The API-first Memory Store/Memory/Version and built-in Skill MVE is additionally
verified by the [Memory API evidence packet](../evidence/claude-memory-api-skill-mve-evidence-packet.md).
It is a completed implementation/evidence slice, not a production-readiness
approval.

## Minimum happy path

1. Validate and publish an immutable Managed Agent version.
2. Create an owner-visible Product Workspace and Fresh ProductSession using the
   explicitly published AgentVersion.
3. Admit a user Message into a durable Task/Run lane.
4. Select and pin the ready Memory Snapshot ID/hash at admission.
5. Verify the exact local FileStore projection and resolve the Session Bootstrap
   and current Run Turn.
6. Execute through `AgentRuntimePort`, persist normalized events and the final
   assistant Message, and read the owner-scoped result.

The Session Bootstrap is the stable Platform Runtime Kernel plus the pinned
published role instructions. Each Run then supplies a per-turn input: the
current Task input, plus optional pinned verified Memory context. The role/System
bootstrap is sent only when the provider Agent is created; later turns use
continuation and send the current turn only. No previous session history, full
Workspace scan, provider-native mount, or retrieval system is implied.

## Queue, cancel, reset, and cursor/SSE

Use the authenticated Task/Run routes to inspect owner-scoped queued and active
work. Cancellation records the durable request and forwards one runtime cancel
when applicable. Session reset advances generation, drains eligible queued old
generation work, and preserves the active-task boundary. Run event replay uses
an opaque cursor; SSE resumes with `after`/`Last-Event-ID` and closes after a
terminal outcome. These are single-node MVP semantics, not distributed recovery
guarantees.

## Memory governance and projection

Create a proposal, review it with `accept`, `edit_and_accept`, or `reject`, then
inspect entries and snapshots. Rebuild creates a new immutable snapshot. The
manual proposal/review path remains unchanged; rejected proposals create no
entry. Local projection verifies the rendered-content hash and manifest before
publishing ready/latest. A pinned snapshot mismatch or missing projection fails
closed: never substitute latest, expose a local path, or disclose hash/path
details in a public error.

## API-first Memory management

The authenticated Memory API creates and lists owner-scoped Stores by requested
Product Workspace UUID, then creates/reads stable Memories under a Store. Each
changed content update uses the current lowercase SHA-256 as a precondition and
appends an immutable Version. Same-content updates are no-ops; reverts append a
new Version. Foreign resources return hidden `404`; duplicate paths return
`409 memory_path_conflict`; stale hashes return `409
memory_precondition_failed`. The management API does not expose public Version
history or Agent-side execution.

The built-in `agent-server/memory-api` Skill is loaded into native create-time
Bootstrap for published managed Agents. It teaches exact methods, paths, and
preconditions, while credentials and an authorized HTTP tool/client remain
external requirements.

## Fresh Session recall

The first Message admission pins the latest ready snapshot for the Product
Workspace. Execution reads that exact snapshot ID/hash, even if a newer snapshot
is created later. A successful run persists the final assistant Message. The
Phase G policy is default-off; `make eval-smoke` is a deterministic safety
evaluation, not an auto-safe rollout.

## Dry-run recovery inspection

The reconciliation inspection is dry-run only. It reports counts and performs
no mutation, retry, cancellation, projection publication, or fallback. Current
local verification evidence reported: `mode=DRY_RUN`, `nonterminal_runs=46`,
`queued_dispatches=81`, `pending_memory_projections=0`,
`failed_memory_projections=4`, `snapshots_lacking_ready_projection=0`, and
`runtime_receipt_reconciliation=unavailable`. These are inspection counts from
a local verification database, not release-state health claims.

## Rollback and escalation

Rollback means deploying the prior application revision while retaining
additive migrations 0001–0008 (including 0005b) and their data. Do not delete
or rewrite accepted entries, snapshots, events, or published AgentVersions.
Stop automated retry for unknown runtime-side effects or persistence failures;
preserve only sanitized evidence and opaque correlation data, then escalate to
the owning orchestration/data operator.

## Limitations

This runbook does not claim production fsync, crash recovery, receipt
reconciliation, backup/restore, multi-node locking, object storage/KMS,
sandboxing, advanced context assembly, model-based gardening, auto-safe
enablement, or rollout readiness. The minimum scenario is approved; deferred
hardening remains in the Follow-up Ledger.

## Filesystem threat boundary

In the single-node MVP, Paseo and Agent Server share one trusted operating-system
account. Runtime content is untrusted, but hostile filesystem racing by another
process with that same UID is explicitly outside the threat boundary. Supporting
that threat requires a separate UID, container, or sandbox.

The existing `lstat`/`realpath` checks, server-created random run directory,
final `O_NOFOLLOW` open, regular-file `fstat`, and bounded max+1 read are
defense-in-depth checks; they are not a complete sandbox against same-UID
interference. Native descriptor-relative `openat`-style handling and a separate
UID/container remain deferred hardening work.
