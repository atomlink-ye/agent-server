# ADR 0003: Paseo process boundary

- Status: accepted
- Date: 2026-07-22

## Context

Paseo already integrates external agent providers and exposes a WebSocket SDK. Agent Server needs stable Task, policy, Workspace, evidence, and channel semantics without absorbing provider process management into domain code.

## Decision

Paseo is the sole V1 leaf-agent runtime and runs as a separate process. Application code calls `AgentRuntimePort`; one adapter owns SDK messages, Workspace/provider lifecycle, status/error normalization, and future compatibility. Local scripts may manage a daemon for developer convenience; the adapter never spawns an OS process. Team coordination stays in the control plane.

The baseline pins Paseo `0.1.110` and OpenCode `1.18.4`, discovers the live model catalog, and automatically chooses only an explicitly free model. External smoke is not a deterministic PR gate.

## Consequences

Paseo failure is visible through readiness and stable Run failure. Production placement, upgrade, isolation, capability, cancel/resume, and event cursors require additional contracts. A second runtime must implement the same leaf contract and compatibility suite; V1 does not auto-route between runtimes.
