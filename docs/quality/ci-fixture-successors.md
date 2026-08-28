# CI fixture successors

The `fixture-product` CI job is a deterministic successor for selected live
runtime lanes. It uses `FixtureRuntimeProvider` through
`createAgentServerHarness` and the production `createApplication` composition.
It never uses Paseo, MCP, provider credentials, or a browser.

Coverage is intentionally bounded:

- `tests/scenarios/fixture-product-successors.scenario.test.ts` covers the
  `runtime-browser` successor as a fixture-backed API/runtime journey only.
  It does not cover browser fidelity. The browser files are explicitly
  local-only live canaries for fixture-successor coverage:
  `e2e/web-product-golden-path.e2e.test.ts` covers the product golden path,
  and `e2e/web-product-session.e2e.test.ts` covers ProductSession live/replay.
  The untouched `real-runtime` workflow continues to execute both as its
  separate live CI canary.
- The same scenario covers team registry reads and Product Work creation and
  projection through the composed application.
- The `agent-team` successor proves team admission reaches a durable terminal
  failed state with the fixture provider. Because the fixture provider does
  not traverse collaboration MCP tools, it cannot prove autonomous
  collaboration; that coverage remains owned by the live `agent-team` canary.

These checks prove deterministic control-plane wiring and fixture replay, not
provider, Paseo, MCP, or browser compatibility.

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
the merge gate will no longer prove provider compatibility, which no fixture
can recover, nor collaboration-pipeline success with tool dispatch. A fixture
must not be described as equivalent coverage for either claim.
