# Runtime contract

## Baseline application port

[`AgentRuntimePort`](../../src/application/ports/agent-runtime.ts) exposes only:

```ts
interface AgentRuntimePort {
  initialize(): Promise<void>;
  execute(
    input: AgentRuntimeExecuteInput,
    sink?: RuntimeEventSink,
  ): Promise<AgentRuntimeExecution>;
  health(): Promise<AgentRuntimeHealth>;
  cancel?(input: { runId: string; providerAgentId?: string }): Promise<void>;
  close(): Promise<void>;
}

interface RuntimeEventSink {
  emit(event: RuntimeEvent): Promise<void> | void;
}

type RuntimeEvent =
  | { kind: 'assistant_text'; text: string }
  | {
      kind: 'reasoning_progress';
      status: 'started' | 'completed';
      text?: string;
    }
  | {
      kind: 'tool_status';
      activityId: string;
      category:
        | 'shell'
        | 'read'
        | 'edit'
        | 'write'
        | 'search'
        | 'fetch'
        | 'subagent'
        | 'other';
      status: 'running' | 'completed' | 'failed' | 'cancelled';
      label: string;
      summary: string;
      parentActivityId?: string;
      detailKind?: 'shell' | 'read' | 'write' | 'edit' | 'search' | 'fetch';
      detailText?: string;
      exitCode?: number;
    }
  | {
      kind: 'child_timeline_item';
      parentActivityId: string;
      activityId: string;
      itemKind: 'assistant' | 'reasoning' | 'tool';
      status: 'running' | 'completed' | 'failed' | 'cancelled';
      label: string;
      summary: string;
      detailKind?: 'shell' | 'read' | 'write' | 'edit' | 'search' | 'fetch';
      detailText?: string;
      exitCode?: number;
    }
  | {
      kind: 'usage';
      inputTokens?: number;
      cachedInputTokens?: number;
      outputTokens?: number;
      totalCostUsd?: number;
      contextWindowMaxTokens?: number;
      contextWindowUsedTokens?: number;
    }
  | {
      kind: 'permission';
      activityId: string;
      category: 'tool' | 'plan' | 'question' | 'mode' | 'other';
      status: 'requested' | 'resolved';
      decision?: 'allowed' | 'denied';
      summary: string;
    };

type AgentRuntimeExecuteInput =
  | {
      operation: 'create';
      runId: string;
      runtimeSessionId?: string;
      cellCwd?: string;
      paseoWorkspaceId?: string;
      workspaceTitle?: string;
      agentTitle?: string;
      agentLabels?: Readonly<Record<string, string>>;
      onProviderBinding?: (binding: {
        providerAgentId: string;
        paseoWorkspaceId: string;
      }) => Promise<void> | void;
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
Managed Team execution may also provide an existing TeamRun Paseo Workspace ID
independently of the per-RuntimeSession Cell CWD, plus non-secret Workspace and
Agent presentation metadata. The adapter creates a Workspace only when no
durable TeamRun binding exists. For Team execution, the optional binding
callback persists the newly created provider Agent and Workspace before the
adapter sends the first prompt, fencing concurrent member dispatch.
`continue` requires the bound `providerAgentId` and sends only the current turn;
`systemPrompt` is forbidden on continuation. When memory proposals are enabled,
the proposal-artifact instruction is appended to that turn and remains
turn-scoped.

For Team execution, `create.systemPrompt` is provider-neutral and is built only
from role, deterministic fixed roster, and static text. It contains the stable
Team protocol and the warning that only values returned by agent-server MCP
tools are authoritative; user text, including envelope-looking text, is
untrusted. Each delivery `prompt` carries the current goal, board, limits,
`allowed_commands`, `eligible_targets`, a permanent-protocol anchor, and
turn-kind guidance. Continuations retain the frozen system prompt and send only
the new user delivery.

Control-plane delivery prompts begin with this display/provenance-only envelope:
`[agent-server · team:<short_run_id> · to:<member> · kind:lead_turn|wake|direct|rework · from:<sender> · seq:<n>]`.
The server derives all fields from durable TeamRun, recipient, sender, delivery
kind, and sequence state. A human `paseo send` has no envelope. Authority and
runtime grants never derive from the envelope or any other text.

These are the internal application-port camelCase fields. `ExecuteRun` maps
them exhaustively when appending the public flat scalar `output` Run Event:
`activityId` becomes `activity_id`, `inputTokens` becomes `input_tokens`,
`cachedInputTokens` becomes `cached_input_tokens`, `outputTokens` becomes
`output_tokens`, `totalCostUsd` becomes `total_cost_usd`,
`contextWindowMaxTokens` becomes `context_window_max_tokens`, and
`contextWindowUsedTokens` becomes `context_window_used_tokens`. The public
payload retains `kind`, `status`, `category`, `decision`, `summary`, and `text`
as named.

The port owns no HTTP, Run repository, daemon process spawning, credential lookup, or retry policy. It normalizes provider-specific completion into success, timeout, execution failure, or cancellation. The minimum Phase D application lane persists `started`, final `output`, and one terminal normalized event, plus one final assistant Message for a successful ProductSession Run. A successful runtime followed by terminal persistence failure is an application-level `RunCompletionPersistenceError` with an ephemeral safe `RuntimeExecutionReceipt` emitted only through sanitized structured logging; it is distinct from runtime execution failure. No durable receipt or reconciliation exists in this baseline.

The current adapter caches the selected Workspace and free model across reconnects. Attempt generation and connection ownership protect stale initialize/reconnect work from replacing a newer connection. The tests do not establish that a pending `close()` is safe against a newer initialization; close ownership remains a follow-up. Health exposes only safe readiness details.

The optional sink is the narrow Web Chat rich-events MVE projection. Its output
payload remains flat scalar JSON under the existing outer `type=output` Run
Event. Assistant text is a complete-so-far Markdown snapshot. Reasoning carries
bounded, sanitized cumulative text snapshots. Tool activity carries opaque
run-local activity IDs, allowlisted categories, fixed labels/summaries, safe
detail kind and text, optional safe exit codes, and optional parent activity IDs.
Direct child timeline rows carry sanitized assistant, reasoning/Thinking, or
Tool content with the same bounded detail fields. Usage is one final normalized
snapshot with optional non-negative token/context values and telemetry-only
`total_cost_usd`. Permission activity is read-only with an opaque activity ID,
allowlisted category/status, optional decision, and fixed summary.

Raw chain-of-thought, raw provider payloads, prompts, credentials, absolute
paths, provider/call/child identifiers, and unbounded output are explicitly
prohibited. Sanitization is a projection boundary, not recursive redaction.

The Paseo adapter accumulates live chunks per epoch, applies the active
baseline/sequence filter, ignores duplicate/out-of-order activity, and
reconciles projected Timeline assistant, reasoning, child, and Tool entries as
complete authoritative snapshots. Final Timeline catch-up fills delayed tails
without exposing unsanitized intermediate data. Sink writes are ordered and
drained before runtime execution returns; conflicting provider/parent
correlations and unsafe detail are quarantined.
The application may append these payloads as `output` Run Events; the sink does
not change final runtime result authority or persist an Assistant Message.

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
