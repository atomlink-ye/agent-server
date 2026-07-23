# Runtime contract

## Baseline application port

[`AgentRuntimePort`](../../src/application/ports/agent-runtime.ts) exposes only:

```ts
interface AgentRuntimePort {
  initialize(): Promise<void>;
  execute(input: { runId: string; prompt: string }): Promise<{
    provider: string;
    model: string;
    text: string;
    usage?: RunUsage;
  }>;
  health(): Promise<AgentRuntimeHealth>;
  close(): Promise<void>;
}
```

The port owns no HTTP, Run repository, daemon process spawning, credential lookup, or retry policy. It normalizes provider-specific completion into success, timeout, or execution failure. A successful runtime followed by terminal persistence failure is an application-level `RunCompletionPersistenceError` carrying only a safe `RuntimeExecutionReceipt`; it is distinct from runtime execution failure.

The current adapter caches the selected Workspace and free model across reconnects. Initialization and close are guarded by attempt generation and connection ownership, so stale initialize/close work cannot replace or close a newer connection. Health exposes only safe readiness details.

## V1 leaf-runtime port

The V1 port accepts only an already persisted, claimed, fenced leaf Agent Run. Team graphs are rejected. It adds capabilities, create/resume session, typed submit, stream/timeline cursor, status, cancel, close, and health. Every input and writeback carries tenant, Task, Run, attempt, activation, owner, fence, current Invokable version, effective principal, Workspace, and credential-policy binding. These Runtime Session V2 APIs are not exposed by the current baseline; the pinned SDK 0.1.110 capability characterization is evidence for a later phase, not a claim of implementation.

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
