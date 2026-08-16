# Paseo Execution Plane

## Purpose

Paseo is Agent Server's primary **Execution Plane**. It owns provider-native agent execution, provider sessions, wire streaming, timeline retrieval, provider permissions, and provider-subagent observation for Claude, Codex, OpenCode, and other runtimes that Paseo supports.

Agent Server does not implement Claude/Codex/OpenCode adapters. It owns durable product/control-plane state and translates between that state and Paseo through one anti-corruption boundary.

The boundary is intentionally **thick**, while each class inside it is narrow.

## Object mapping

| Agent Server         | Paseo                              | Ownership                                  |
| -------------------- | ---------------------------------- | ------------------------------------------ |
| Work                 | none                               | Agent Server                               |
| Task                 | none                               | Agent Server                               |
| Run                  | Turn/execution                     | Agent Server durable truth; Paseo executes |
| RuntimeWorkspace     | Workspace                          | Agent Server durable identity/binding      |
| RuntimeSession       | Agent/session binding              | Agent Server durable identity/binding      |
| RuntimeCell          | cwd                                | Agent Server placement                     |
| ExecutionObservation | projected timeline/stream activity | normalized by Agent Server boundary        |
| TeamMemberRun        | separate RuntimeSession/Agent      | Agent Server                               |
| provider subagent    | nested runtime activity            | Paseo/provider; never a TeamMemberRun      |

## Integration roles

```text
Application
  -> ExecutionRuntimeService
      -> ExecutionSessionResolver
          -> ExecutionPlanePort
              -> PaseoExecutionPlane
                  -> PaseoConnectionManager
                  -> PaseoGateway
                  -> PaseoExecutionSession
                      -> PaseoTurnRunner
                          -> PaseoObservationProjector
```

### PaseoExecutionPlane

Facade for daemon-level concerns: initialization, health, capability advertisement, external Workspace/Agent creation, and attach of an existing durable binding.

It never owns Task, Run, Work, Team, Memory, or ProductSession state.

### PaseoConnectionManager

Owns connection/reconnect generation, the default bootstrap Workspace used for catalog/model resolution, and the resolved model catalog state. It does not own per-Turn projection.

### PaseoGateway

Thin wrapper over the pinned `@getpaseo/client` SDK. It exposes connection, Workspace, Agent, send/wait, timeline, provider-subagent, cancel, and close operations. Product policy and durable state are forbidden here.

The repository currently pins Paseo `0.1.110`. `paseo-launch-policy.ts` contains the small provider-mode compatibility shim required by that SDK version. This is not a provider adapter and should disappear when the supported Paseo SDK resolves provider-native launch mode itself.

### PaseoExecutionSession

Process-local handle for one durable RuntimeSession binding. `run()` creates one Turn lifetime, `cancel()` targets an active Turn, and `close()` releases only the process-local handle. `close()` must not archive or destroy the external Paseo Agent/Workspace.

### PaseoTurnRunner

Owns one Run/Turn lifetime: baseline capture, live subscriptions, send, wait, periodic nested reconciliation, terminal catch-up, timeout/cancel mapping, and disposal.

### PaseoObservationProjector

Stateful reducer of live stream + final timeline + provider-subagent activity into provider-neutral `ExecutionObservation`. It owns epoch/sequence filtering, deduplication, monotonic tool projection, child correlation, and boundary sanitization. It does not persist RunEvent or Memory state.

## Durable identity and binding order

A sticky managed session follows this order:

```text
1. create/load durable RuntimeSession
2. resolve RuntimeWorkspace ownership
3. create external Paseo Workspace/Agent when unbound
4. receive neutral WorkspaceBinding + SessionBinding
5. persist both bindings on RuntimeSession
6. only then send the first Turn prompt
```

If binding persistence fails, the first prompt is not sent. If an existing binding cannot be attached, execution fails explicitly. The system never silently creates a replacement Agent.

The first refactor round intentionally keeps the existing DB columns `paseo_workspace_id` and `provider_agent_id`. PostgreSQL repositories map those columns to neutral `{ plane, externalWorkspaceId }` and `{ plane, externalSessionId }` values. Application code must not depend on the column/provider vocabulary.

## RuntimeWorkspace ownership

`RuntimeWorkspace` is a lightweight durable identity/projection, not a new state machine.

- ProductSession owns a ProductSession-scoped RuntimeWorkspace.
- TeamRun owns a TeamRun-scoped RuntimeWorkspace.
- Team members share that external Workspace but each member owns a separate RuntimeSession, RuntimeCell, and Paseo Agent.
- A fresh Task has no sticky RuntimeWorkspace/RuntimeSession requirement unless a product scope supplies one.

The compatibility persistence adapter derives RuntimeWorkspace binding from existing RuntimeSession rows so this refactor does not require a DB migration.

## RuntimeSession policy

Current compatibility policy is explicit:

- ProductSession: `sticky`
- TeamMember: `sticky`
- standalone Task: `fresh`

Sticky means the RuntimeSession identity and external binding are reused across Runs. Fresh means the Run receives a new external execution session and no long-lived RuntimeSession identity is invented.

## State authority

There is deliberately no durable `RuntimeSession.running/idle` state machine.

- `Task.status` / `Run.status` are durable control truth.
- RuntimeSession stores identity, launch snapshot, and bindings.
- Paseo Agent lifecycle is observed runtime state.
- `ExecutionRunRegistry` is process-local only, used to reach the currently attached ExecutionSession for cancellation.
- UI/history comes from RunEvent/trace projections.

A read-only `RuntimeSessionProjection` can derive binding/activity/availability without persisting another lifecycle.

## Observation boundary

Paseo stream/timeline/provider-subagent data flows through:

```text
Paseo event
  -> PaseoObservationProjector
  -> ExecutionObservation
      -> executionObservationPayload
      -> RunEvent
```

Memory candidate extraction is a separate downstream concern. The Execution Plane never owns Memory policy.

Provider-native identifiers, host paths, credentials, and raw payloads are not product events. The projector and application projection keep the existing safe trace contract.

## Capability negotiation

Plane capabilities and Session capabilities are distinct. Callers use explicit capability helpers before relying on optional behavior. This allows future Paseo features to be adopted without spreading provider conditionals through Application code.

## Failure semantics

Expected Turn completion is represented as a result union: completed, failed, or cancelled. Transport/daemon unavailability, invalid bindings, unsupported capabilities, and protocol violations remain explicit exceptions.

There is no background reconciler or binding generation mechanism in this round. Recovery beyond explicit attach/fail is deferred until real operational evidence requires it.

## Non-goals

This refactor does not:

- upgrade Paseo;
- add direct Claude/Codex/OpenCode adapters to Agent Server;
- redesign the DB schema;
- add a RuntimeSession lifecycle state machine;
- add automatic Agent replacement;
- add a background reconciler;
- change public product/API behavior;
- turn provider subagents into Agent Server Team members.
