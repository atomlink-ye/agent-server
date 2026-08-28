# CI fixture successors

The `fixture-product` CI job is a deterministic successor for selected live
runtime lanes. It uses `FixtureRuntimeProvider` through
`createAgentServerHarness` and the production `createApplication` composition.
It never uses Paseo, MCP, provider credentials, or a browser.

Coverage is intentionally bounded:

- `tests/scenarios/fixture-product-successors.scenario.test.ts` covers the
  `runtime-browser` successor as a fixture-backed API/runtime journey only.
  The additive `fixture-browser` job also runs
  `e2e/web-product-golden-path.e2e.test.ts` (Coworker/capability/Work UI) and
  `e2e/web-product-session.e2e.test.ts` (ProductSession live/replay) against
  the explicitly fixture-backed dev server. It proves browser-to-server
  wiring and deterministic replay, including per-turn markers. It does not
  prove provider compatibility, MCP traversal, or the Paseo adapter. Marker
  echo is limited to the fixture marker protocol and is not evidence that a
  provider follows an instruction. The live canaries are owned by the
  Sandbox/local contract below, not by CI; fixture coverage does not replace
  them.
- The same scenario covers the `team-product` successor: team registry reads,
  Product Work creation and projection, and a Product WorkRun started through
  `POST /api/v1/works/:workId/runs` and executed through the dispatcher to the
  fixture provider, reaching product state `complete` with a `succeeded` run in
  its trace. This covers the deterministic half of the paid lane's two halves
  (registry/projection reachability, and the Work execution lifecycle). It does
  not cover real-provider execution.
- The `agent-team` successor proves that team admission executes a lead run
  through the fixture provider and the Team then reaches a durable terminal
  state with stop reason `lead_no_progress`. Because the fixture provider does
  not traverse collaboration MCP tools, the lead makes no protocol progress; the
  successor therefore cannot prove autonomous collaboration or replace the live
  `agent-team` canary.

These checks prove deterministic control-plane wiring, fixture replay, and the
bounded browser journeys above; they do not prove provider, Paseo, or MCP
compatibility.

## Live-canary contract

**No CI workflow runs a real provider.** The `real-runtime` workflow was deleted
once its lanes had deterministic successors; the repository's merge gate is now
entirely deterministic. Everything a real provider used to prove in CI is
retained here, as an explicitly named canary rather than a silent gap.

**Execution locus: a Sandbox, or the Release Engineer's local host.** Never CI,
because CI has no provider credential by design. The Release Engineer owns these
canaries. Run each affected one before a release, when the provider SDK version
changes, or when `src/adapters/paseo/**` changes. These are triggers, not a
calendar cadence.

| Canary                              | Exact command                                                        |
| ----------------------------------- | -------------------------------------------------------------------- |
| Runtime/provider/tool compatibility | `pnpm canary:runtime`                                                |
| Browser/API/runtime golden path     | `pnpm canary:golden-path`                                            |
| Agent-team collaboration + MCP flow | `pnpm smoke:agent-team`                                              |
| Team-registry Work flow             | `pnpm smoke:team-registry-work`                                      |
| Team Work execution lifecycle       | `node --import tsx tooling/dev/run-canary.ts user-defined-team-work` |

Record each run's date, SHA, command, exit code, and execution locus in the
[live-provider canary receipts ledger](https://github.com/atomlink-ye/agent-server/issues/139),
not in this repository. Those receipts are one-run evidence and must not enter
Git; this document is the durable operating contract, not a results ledger.

`agent-team` has now retired from paid CI. That is an explicit coverage
reduction, recorded rather than absorbed: the merge gate no longer proves
real-provider collaboration, MCP/tool compatibility, or collaboration-pipeline
success with tool dispatch. A fixture must not be described as equivalent
coverage for any of those claims. `pnpm smoke:agent-team` is where that coverage
now lives.

`team-product` has also retired from paid CI. The fixture successor executes a
Product WorkRun deterministically rather than only creating and reading one, so
the control-plane execution lifecycle is covered in CI. It still does not replace
real-provider execution or provider/tool compatibility for that lane, which
remain explicit live-canary scope under the contract above until a later
authority decision.

`runtime-browser` has likewise retired. Its two browser journeys still run in CI
under `fixture-browser` against a fixture-backed server, so the browser-to-server
half is covered; the real-provider half is not, and is the
`pnpm canary:golden-path` canary above.

## A fixture that could not fail

Until this round the harness seeded an Environment whose canonical package was
`{}`. Such a row reads back correctly through the registry, so registry and
projection assertions passed, but `AgentRunExecutor` rejects it before execution
("Work runtime Environment is not supported"). Two consequences followed:

- no Product WorkRun could execute deterministically at all, which is why the
  `team-product` successor previously stopped at create/read; and
- the `agent-team` successor's terminal `lead_run_failed` was produced by that
  invalid seed rather than by Team behaviour — it asserted an artefact of a
  broken fixture.

The seed now writes a real supported `ManagedEnvironment` package. Both
successors execute through the provider seam, and the `agent-team` terminal
state is one the Team actually decided. This is recorded because a passing
assertion whose cause is a defective fixture is worse than a missing one: it
reports coverage that does not exist.
