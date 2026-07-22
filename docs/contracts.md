# Contracts

Contracts are versioned boundaries that adapters and clients must test. They are smaller than implementation internals and must preserve safe error normalization.

- [Run and Task API](contracts/run-api.md) documents the implemented baseline routes and V1 evolution.
- [Health API](contracts/health-api.md) defines liveness and dependency readiness.
- [Runtime contract](contracts/runtime-contract.md) defines the leaf-agent application port and planned compatibility surface.

Changing a public field, status meaning, model-selection authority, or runtime responsibility is a Human Gate and requires contract tests plus documentation updates.
