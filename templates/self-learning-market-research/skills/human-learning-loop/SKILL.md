---
name: human-learning-loop
description: Keeps learning proposal creation and recall human-reviewed.
---

# Human learning loop

This skill requires the `lead` tool profile when used by the lead agent. That
profile grants the `learning_proposal_create` and `agent_server_memory_read`
operations without granting
them to the other roles.

In `learn` mode, decode `memory_store_id`, `memory_path`, and `fixture_ref` from
the root input. Before finalization and before returning the six-section report,
call `learning_proposal_create` exactly once with `memory_store_id` and
`target_path` from those root values, `proposed_content` containing the literal
disclaimer **synthetic demo only**, and `evidence_refs` containing fixture refs
from the root input. A structured receipt whose `status` is `pending` is the
only success signal. Do not use shell, files, a scratchpad, or prose to simulate
the call; runtime never writes Memory directly.

In `recall` mode, decode `memory_store_id` and `memory_path` from the root input
and first call `agent_server_memory_read` with `memory_store_id` and `path` set
from those values. Report the returned path, version, content SHA, principle,
and how it was applied. Never use hidden first-run history and never turn the
result into investment advice.
