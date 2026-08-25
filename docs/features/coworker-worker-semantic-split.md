# Coworker Agent / Worker semantic split

Status: implementing

Research: https://docs.google.com/document/d/1JJPnL4Ly_bEzCaNUoYQolNECZXTb55Z2ggeUG0A2T5s/edit

Roadmap: https://docs.google.com/document/d/1gZzgQnaEGc4qff3SeKZ9pFhJ4MHqfGRcSognUOYsueo/edit

Base: `master@1c9b91630fcb8b5831ef474da9ae79e1e83378d4`.

This refactor makes the product ontology explicit:

- `AgentDefinition` / `AgentVersion` are long-lived Cumora-style Coworker / Chat identity.
- `WorkDefinition` is the formal job or workflow contract.
- `WorkerDefinition` / `WorkerVersion` are reusable formal execution roles.
- an Agent exposes formal capabilities through an explicit Work Catalog binding to one or more WorkDefinitions.
- Work and Team execution no longer materialize or publish Coworker Agents as internal participants.
- Chat and Worker projections reuse the same durable RuntimeSession / Generation / Turn substrate without sharing product identity.

The implementation is complete only when the full Roadmap cutover is landed and the old active Work→Agent semantic path is removed; this file is the repository navigation point, not a substitute for the detailed Roadmap.
