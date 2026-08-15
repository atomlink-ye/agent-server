# Testing and evaluations

Agent Server separates deterministic software verification from Agent/model-quality evaluation and from real external smoke.

## Core rule

```text
Topology × Fixture × Test Case
```

Topology defines infrastructure. Fixture defines starting product data. Test Case defines assertions. A phase-specific runner that owns all three is a design smell.

## Deterministic tests

### Unit

Pure domain/application/helper/config behavior. No Docker, provider, or real network.

```bash
pnpm test:unit
```

### Contract

Public request/response/schema/error contracts, normally in-process.

```bash
pnpm test:contract
```

### Integration

Component/repository/adapter boundaries. PGlite is the default database when its semantics are sufficient.

```bash
pnpm test:integration
```

For PostgreSQL-specific transaction, lock, concurrency, migration, or SQL semantics use the real-Postgres lane:

```bash
pnpm test:real-pg
```

The lane self-starts a disposable PostgreSQL environment when no external database URL is supplied.

### E2E

Complete deterministic process/socket paths with fake/controlled execution where possible.

```bash
pnpm test:e2e
```

## Repository tests

`tests/repository` contains only small stable structural invariants, such as repository hygiene, attribution, and a narrow module import boundary. These tests must not grow into a semantic policy engine or mutation harness.

```bash
pnpm test:repository
```

## External smoke

A smoke is a small canonical real-system main flow. It may use Paseo/provider credentials and is therefore explicit opt-in, not an ordinary PR gate.

```bash
pnpm smoke:runtime
pnpm smoke:agent-team
```

Do not preserve each development phase as a separate smoke. When a newer flow supersedes an older one, keep the current canonical scenario.

## Evals

Evals measure persistent Agent/model behavior rather than deterministic software correctness. They live under `evals/` with versioned datasets/metrics when appropriate.

```bash
pnpm eval:memory
```

A product/code assertion should not become an eval merely because an Agent is involved; an Agent-quality judgement should not be encoded as a brittle unit test.

## Environment lifecycle

Dev and Test share `config/local-environments.yaml`. Infrastructure-backed tests use `tests/support/environment` to allocate an isolated run/project, start only required services, expose typed URLs, and clean up.

Stable topologies:

- `in-process`
- `postgres`
- `core`
- `runtime`
- `full`

Manual `pnpm local-env up ...` is for interactive debugging. It is not a hidden prerequisite for tests.

## Fixtures

Prefer typed builders for Workspace/Agent/Environment/Team/Session/database setup. JSON/YAML fixtures are appropriate when the serialized representation itself is the stable input under test.

If a fixture needs a temporary variation, use a typed override in the test instead of adding phase/task-specific mutation files.

## Generated diagnostics

All generated test/run diagnostics belong under:

```text
.local/test-runs/<run-id>/
```

Successful runs may remove the directory. `TEST_KEEP_FAILED=1` may retain failed diagnostics locally. CI may upload the directory as a workflow artifact. Generated output is never committed as a source/evidence directory.
