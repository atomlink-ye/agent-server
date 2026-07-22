# Contracts

Contracts are versioned boundaries that adapters and clients must test. They are smaller than implementation internals and must preserve safe error normalization.

- [Run compatibility API](contracts/run-api.md) documents the implemented compatibility routes and their canonical Task relationship.
- [Task API](contracts/task-api.md) documents the implemented canonical invoke/read/tree routes.
- [Agent and Team registry contract](contracts/agent-team-api.md) documents the implemented durable invokable model and current public-route boundary.
- [Health API](contracts/health-api.md) defines liveness and dependency readiness.
- [Runtime contract](contracts/runtime-contract.md) defines the leaf-agent application port and planned compatibility surface.

Changing a public field, status meaning, model-selection authority, or runtime responsibility is a Human Gate and requires contract tests plus documentation updates.
