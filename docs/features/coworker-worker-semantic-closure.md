# Coworker / Worker semantic closure

Status: implementation complete on PR #119; exact-head CI is the acceptance authority.

The implementation Roadmap is maintained in Google Drive:

https://docs.google.com/document/d/1K5XSagXvaLk89gfNJE1LUSMkevwHbptx4ZvU8IyP12I/edit

This closure makes the existing Coworker/Worker split the only active repository truth across exact Worker owner scope, Agent Work Catalog lineage, additive migration repair, Product/Web contracts, projections, tests, and authority docs. It is intentionally not another architecture redesign.

The completed invariants are:

- formal Worker resolution, name convergence, and idempotency use exact tenant/workspace/principal owner scope;
- Agent Work Catalog bindings prove one Coworker owner plus one exact published WorkDefinitionVersion lineage;
- migration 0061 repairs orphan legacy wake rows and strengthens the Worker/catalog persistence constraints without rewriting 0058-0060;
- active WorkDefinition authoring and browser contracts use `single_worker` / `worker_version_id` and shared Product schemas;
- Timeline activity identity includes Run provenance, and Work Overview does not duplicate an unheaded result's promoted first line;
- repository authority docs describe the completed cutover, and the compatibility-surface gate rejects reintroduction of Agent-shaped Work composition on active Product/Web surfaces.

Historical Agent-shaped Work rows remain migration/audit evidence only. The explicit direct-Agent technical Task compatibility ingress is not a formal WorkDefinition authority. No semantic-closure TODO, dual-write authority, or deferred closure item remains in this implementation.

After this PR, the Coworker/Worker object model is frozen for MVE feature development unless a concrete Product feature demonstrates a need to change it. The recommended next product sequence is Agent Work Catalog / Coworker capability UX, then Artifact & Evidence, then Attention / Review.
