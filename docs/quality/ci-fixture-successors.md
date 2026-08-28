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
  provider follows an instruction. The separate `real-runtime` workflow owns
  the live canaries when its eligibility and credential gates allow them to
  run; fixture coverage does not replace those canaries.
- The same scenario covers team registry reads and Product Work creation and
  projection through the composed application.
- The `agent-team` successor proves only that team admission reaches a durable
  terminal failed state with the fixture provider. Because the fixture provider
  does not traverse collaboration MCP tools, it cannot prove autonomous
  collaboration or replace the live `agent-team` canary.

These checks prove deterministic control-plane wiring, fixture replay, and the
bounded browser journeys above; they do not prove provider, Paseo, or MCP
compatibility.

## Live-canary contract

The Release Engineer owns the local live canaries below. Run each affected
canary before a release, when the provider SDK version changes, or when
`src/adapters/paseo/**` changes. These are triggers, not a calendar cadence.

| Canary                          | Exact command                   |
| ------------------------------- | ------------------------------- |
| Runtime/provider compatibility  | `pnpm canary:runtime`           |
| Browser/API/runtime golden path | `pnpm canary:golden-path`       |
| Agent-team collaboration flow   | `pnpm smoke:agent-team`         |
| Team-registry Work flow         | `pnpm smoke:team-registry-work` |

Record each run's date, SHA, command, exit code, and execution locus in the
[live-provider canary receipts ledger](https://github.com/atomlink-ye/agent-server/issues/139),
not in this repository. Those receipts are one-run evidence and must not enter
Git; this document is the durable operating contract, not a results ledger.

When `agent-team` retires from paid CI, that is an explicit coverage reduction:
the merge gate will no longer prove real-provider collaboration, MCP/tool
compatibility, or collaboration-pipeline success with tool dispatch. A fixture
must not be described as equivalent coverage for any of those claims.

When `team-product` retires from paid CI, that is also an explicit coverage
reduction: registry/read/create/projection fixture coverage does not replace
the real-provider user-defined Team Work execution or compatibility coverage
owned by the `team-product` live canary. It remains explicit live-canary scope
until a later authority decision.
