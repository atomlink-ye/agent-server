# ADR 0002: TypeScript modular monolith

- Status: accepted
- Date: 2026-07-22

## Context

The first team is small and needs fast local feedback, explicit boundaries, testable adapters, and readable code. Premature services would add deployment and contract overhead before durable ownership is established.

## Decision

Use Node.js, TypeScript, Hono, Zod, Vitest, pnpm, and a modular-monolith structure. Domain is framework-free; application defines ports/use cases; adapters and infrastructure implement boundaries; entrypoints expose transport. Pull-request gates are deterministic and external model smoke is separate.

## Consequences

Components are logical boundaries first. Extraction requires evidence such as security isolation, independent scaling, failure containment, or ownership. Type/schema duplication across public contracts should be deliberate; runtime SDK types cannot become domain types.
