# Testing and evaluations

Agent Server separates deterministic software verification from Agent/model-quality evaluation, live runtime compatibility, and production-like acceptance.

## Core rule

```text
Test the seam continuously.
Test the world periodically.
```

A developer should be able to identify which boundary failed. Do not use a live model, browser, scheduler timing, container topology, and real database simultaneously when the assertion only concerns deterministic product wiring.

## Validation lanes

| Lane | Default dependencies | Purpose | Canonical command |
| --- | --- | --- | --- |
| L0 Unit | none | pure logic/state/validation | `pnpm test:unit` |
| L1 Integration | PGlite/fakes as appropriate | module/repository wiring | `pnpm test:integration` |
| L2 Scenario | PGlite + scripted runtime decision | complete deterministic product journey | `pnpm test:scenario` |
| L3 PostgreSQL semantic | dedicated local real PostgreSQL | PG-only locking/transaction/index behavior | `pnpm test:pg` |
| L4 Runtime canary | Paseo + real provider | runtime/provider/tool compatibility | `pnpm canary:runtime` |
| L5 Product canary | host-native API/Web/runtime/browser | representative user journey | `pnpm canary:golden-path` |
| L6 Acceptance | production-like topology | milestone/release evidence | `pnpm acceptance:run` |

The normal `pnpm test` aggregate stops at deterministic lanes. Live provider/browser/acceptance work is explicit.

## Unit

Pure domain/application/helper/config behavior. No Docker, provider, real network, or real PostgreSQL.

```bash
pnpm test:unit
```

## Contract

Public request/response/schema/error contracts, normally in-process.

```bash
pnpm test:contract
```

## Integration — PGlite by default

Component/repository/adapter boundaries use PGlite when its semantics are sufficient:

```bash
pnpm test:integration
```

PGlite is not treated as proof of PostgreSQL-only locking/concurrency behavior. It is the fast deterministic default for ordinary persistence wiring.

## Deterministic product scenarios

```bash
pnpm test:scenario
```

North Star scenarios use:

- real Agent Server domain/application/module code;
- real repositories and migrations;
- real production MCP handlers;
- semantic test fixtures;
- explicit worker `step()` calls;
- a scripted runtime/model decision boundary.

The fake is the probabilistic decision boundary, not the product system. A scenario must not depend on whether Claude/Codex happens to choose the desired tool on that run.

Reusable composition belongs in `tests/harness/`, not in every scenario file. Prefer:

```text
seed.workspace()
seed.agentVersion()
seed.environmentVersion()
seed.teamVersion()
seed.conversation()
seed.workDefinition()
seed.goldenPath()
```

over repeated table-shaped fixture SQL.

`pnpm test:north-star` is a compatibility alias for this lane.

## Real PostgreSQL semantic tests

Only use this lane for PostgreSQL behavior PGlite should not claim to prove:

```text
FOR UPDATE / SKIP LOCKED
advisory locks
transaction/concurrency races
connection-level behavior
PostgreSQL-only index/constraint semantics
real migration concurrency
```

The developer opts in with a dedicated local database:

```bash
createdb agent_server_test
TEST_DATABASE_URL=postgresql://$USER@127.0.0.1:5432/agent_server_test pnpm test:pg
```

The runner:

1. does **not** start Docker;
2. skips cleanly when neither `TEST_DATABASE_URL` nor `INTEGRATION_DATABASE_URL` is set;
3. refuses database names without `test`;
4. refuses `prod`, `production`, `main`, or `live` database names;
5. passes the selected URL to the existing real-PG Vitest suite.

`pnpm test:real-pg` is a compatibility alias.

CI may supply PostgreSQL as a service container. The important boundary is that the test harness does not secretly own a Compose lifecycle.

## Deterministic worker testing

Background loops are an outer runtime concern. Important workers expose:

```ts
step(): Promise<{ kind: 'idle' } | { kind: 'processed'; value?: unknown }>
```

Production `start()` loops repeatedly call the same step. Tests call `step()` directly. Do not write:

```text
start worker
sleep
poll
hope
```

for a state transition that can be asserted after one deterministic unit of work.

## Repository tests

`tests/repository` contains only small stable structural invariants, such as repository hygiene, attribution, and narrow module import boundaries.

```bash
pnpm test:repository
```

Repository tests must not grow into an alternative semantic policy engine or a second acceptance system.

## Browser/process E2E

Browser/process E2E is explicit:

```bash
pnpm test:e2e
pnpm test:e2e:web
```

Do not put real provider choice into deterministic E2E merely to make the path feel more realistic.

## Runtime and product canaries

```bash
pnpm canary:runtime
pnpm canary:golden-path
```

A runtime canary validates current external compatibility: provider credentials, Paseo startup, model normalization, tool visibility, and one real turn.

A product canary validates a representative host-native API/Web/runtime journey. It may fail for external reasons even when deterministic product scenarios are green; that distinction is intentional and diagnostic.

## Acceptance

Acceptance is milestone/release evidence, not the ordinary coding loop. It may use production-like Compose topology, browser instrumentation, provider transcripts, screenshots, manifests, hashes, and other evidence when the milestone requires them.

Do not require an acceptance evidence bundle for every local feature edit.

## Evals

Evals measure persistent Agent/model behavior rather than deterministic software correctness. They live under `evals/` with versioned datasets/metrics when appropriate.

```bash
pnpm eval:memory
```

A product/code assertion should not become an eval merely because an Agent is involved; an Agent-quality judgement should not be encoded as a brittle deterministic test.

## Environment ownership

Host-native developer orchestration lives in `tooling/dev/`.

Docker/production-like topology lives in:

```text
config/local-environments.yaml
tooling/environment/
compose*.yaml
```

Manual Compose environments are explicit compatibility/debugging choices:

```bash
pnpm dev:docker
pnpm dev:docker:runtime
pnpm dev:docker:full
```

## Fixtures and harness

Prefer typed semantic builders for Workspace/Agent/Environment/Team/Conversation/Work setup. JSON/YAML fixtures are appropriate when the serialized representation itself is the input under test.

If fixture setup repeats in multiple scenarios, move it into `tests/harness/seed/`. If application composition repeats, move it into `tests/harness/agent-server-harness.ts`. Do not solve setup friction with a task-specific shell script.

## Generated diagnostics

Generated test/run diagnostics belong under ignored `.local/` paths or CI artifacts. Logs, screenshots, recordings, provider transcripts, one-run API captures, mutation output, and task handoff artifacts are not repository source.
