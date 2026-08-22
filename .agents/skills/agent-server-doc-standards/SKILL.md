---
name: agent-server-doc-standards
version: 1.0.0
triggers: [write docs, move docs, architecture docs, audit docs]
inputs: [explicit documentation scope]
outputs: [current-state documentation changes]
permissions: [read and edit repository docs]
---

# Agent Server Documentation Standard

Keep one current owner for each fact.

## Homes

- `README.md`: runnable baseline and repository map.
- `AGENTS.md`: coding-agent entry, immutable boundaries and canonical commands.
- `docs/product/**` / `docs/features.md`: product scope and current capability status.
- `docs/architecture/**`: current module/data/interface/recovery invariants.
- `docs/contracts/**`: public HTTP/MCP/runtime schemas and errors.
- `docs/decisions/**`: durable rationale and alternatives.
- `docs/exec-plans/**`: active implementation state; move out of `active` when complete.
- `docs/quality/**`: tests, evals, canaries and quality gates.

## Rules

Write from HEAD's point of view. Do not keep PR choreography, temporary phase names, review arguments or completed implementation checklists in current-state architecture prose. Keep rationale only when it prevents a plausible future mistake and place it in the owning Decision.

Before moving a document, search inbound links and change them atomically. Do not hand-edit generated artifacts. A longer document is acceptable when its subject requires detail; duplication and mixed ownership are the defects, not word count alone.

Validate touched docs with `pnpm docs:check` and the relevant repository gates.
