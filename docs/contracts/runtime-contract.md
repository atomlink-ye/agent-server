# Runtime contract

## Baseline application port

[`AgentRuntimePort`](../../src/application/ports/agent-runtime.ts) exposes only:

```ts
interface AgentRuntimePort {
  initialize(): Promise<void>;
  execute(input: AgentRuntimeExecuteInput): Promise<AgentRuntimeExecution>;
  health(): Promise<AgentRuntimeHealth>;
  cancel?(input: { runId: string; providerAgentId?: string }): Promise<void>;
  close(): Promise<void>;
}

type AgentRuntimeExecuteInput =
  | {
      operation: 'create';
      runId: string;
      systemPrompt: string;
      prompt: string;
      memoryCandidates?: {
        maxCandidates?: number;
        proposalLimit?: number;
      };
    }
  | {
      operation: 'continue';
      runId: string;
      providerAgentId: string;
      prompt: string;
      memoryCandidates?: {
        maxCandidates?: number;
        proposalLimit?: number;
      };
    };
```

`create` sends the native `systemPrompt` plus the initial/current turn.
`continue` requires the bound `providerAgentId` and sends only the current turn;
`systemPrompt` is forbidden on continuation. When memory proposals are enabled,
the proposal-artifact instruction is appended to that turn and remains
turn-scoped.

The port owns no HTTP, Run repository, daemon process spawning, credential lookup, or retry policy. It normalizes provider-specific completion into success, timeout, execution failure, or cancellation. The minimum Phase D application lane persists `started`, final `output`, and one terminal normalized event, plus one final assistant Message for a successful ProductSession Run. A successful runtime followed by terminal persistence failure is an application-level `RunCompletionPersistenceError` with an ephemeral safe `RuntimeExecutionReceipt` emitted only through sanitized structured logging; it is distinct from runtime execution failure. No durable receipt or reconciliation exists in this baseline.

The current adapter caches the selected Workspace and free model across reconnects. Attempt generation and connection ownership protect stale initialize/reconnect work from replacing a newer connection. The tests do not establish that a pending `close()` is safe against a newer initialization; close ownership remains a follow-up. Health exposes only safe readiness details.

## V1 leaf-runtime port

The V1 port accepts only an already persisted, claimed, fenced leaf Agent Run. Team graphs are rejected. It adds capabilities, create/resume session, typed submit, stream/timeline cursor, status, cancel, close, and health. Every input and writeback carries tenant, Task, Run, attempt, activation, owner, fence, current Invokable version, effective principal, Workspace, and credential-policy binding. These Runtime Session V2 APIs are not exposed by the current baseline; the pinned SDK 0.1.110 capability characterization is evidence for a later phase, not a claim of implementation.

Full Runtime Session V2 create/resume/status APIs are not exposed by the current baseline. The pinned SDK 0.1.110 capability characterization is evidence for a later phase, not a claim of implementation; incremental provider deltas and rich usage remain deferred.

The Managed Environment MVE adds an internal RuntimeSession and derived Runtime
Cell per ProductSession. The Cell supplies the native Skill projection and
scoped receipts; the adapter opens a Paseo Workspace there and reuses the bound
provider Agent for later Runs. These are internal baseline semantics, not
public Runtime Session V2, production isolation, restart reconstruction, or
crash-recovery guarantees.

## Compatibility requirements

Each adapter version must pass:

- schema round trip and unknown event handling;
- provider timeout, permission, cancel, disconnect, and reconnect;
- cursor replay and duplicate/out-of-order event behavior;
- tenant/security context preservation and stale-fence rejection;
- secret absence in events, logs, errors, and tool results;
- idempotent submit or explicit receipt semantics;
- runtime version/capability negotiation;
- rejection of Team versions and caller-forged security context.

The adapter may retain a sanitized raw-event sidecar for unknown events. UI and business code consume normalized control-plane events, never Paseo wire messages.
