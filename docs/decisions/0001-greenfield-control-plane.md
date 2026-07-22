# ADR 0001: Greenfield control plane

- Status: accepted
- Date: 2026-07-22

## Context

The legacy `backup` branch demonstrates prior behavior but mixes product/runtime concerns and may constrain later identity, durability, Team, credential, and channel work. The new product direction treats Paseo and external coding agents as runtimes beneath a platform-owned Harness.

## Decision

Develop from the empty `master` baseline. Use legacy code only as read-only behavior evidence. Re-state required product, component, contract, quality, and operations authority in this repository. Do not begin with a cleanup or incremental migration of the old code.

## Consequences

Early work must build a small walking skeleton and explicit seams before feature volume. No legacy API or behavior is implicitly compatible. Any intentionally restored behavior needs a Feature requirement, contract, test, and migration decision.
