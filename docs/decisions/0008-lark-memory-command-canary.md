# ADR 0008: Fixed Lark Managed Memory command canary

## Status

Accepted as a compatibility baseline; not a production identity or rollout
decision.

## Decision

Agent Server owns Lark ingress, binding, review authorization, Memory state
transitions, and outbound delivery evidence. The first supported seam is one
explicitly enabled `agent-test` App/domain, one configured group, one allowlisted
external user, and one fixed service-account Tenant/Workspace/published
AgentVersion/policy tuple. It is disabled by default and is not a canonical
User, Membership, ACL, or general channel administration model.

The low-level official SDK WebSocket receiver derives verified bot mentions and
durably commits bounded normalized ingress before acknowledgement. New roots and
Thread commands use the shared trusted Lark Session turn path. A successful
source Run may create one command-only review notification. `/memory
edit-and-accept` (and bounded accept/reject forms) is authorized against the
configured chat/user, active binding, source Session, and exact owner tuple.

Review is authoritative in the existing Workspace Memory state machine:
proposal → accepted Entry → hash-verified ready snapshot. A later root creates a
Fresh Session and pins the exact snapshot ID/hash at admission. Card and Bot Doc
are implemented projection/control surfaces, not alternate Memory truth; Thread
command remains the fallback. Long proposals use a Bot-owned editable Doc body
and unresolved comments/replies to generate an immutable Preview, then a
separate Accept Preview accepts that exact persisted content/hash.

The Channel core retains only bounded scalar fields, safe identifiers, and
review/delivery state. It retains no raw provider event, callback token, secret,
raw provider error, prompt, or local path. The durable outbox records attempts
and reuses a provider UUID while safe. Ambiguous provider execution can become
`delivery_unknown`; physical exactly-once delivery is not claimed.

## Consequences and deferred work

This baseline proves the fixed command/Card/Doc compatibility path and keeps normal
Task/Run/Session/Memory ownership in the control plane. It does not prove
multi-node leadership, crash recovery, broad redrive/fault injection,
performance, canonical Lark identity, or production readiness. Normal-path
provider evidence is bounded; deferred hardening is owned by the active Task 14
follow-up plan.
