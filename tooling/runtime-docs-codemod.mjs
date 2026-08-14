import { readFile, writeFile } from 'node:fs/promises';

const runtimeContract = `# Execution Plane Runtime Contract

## Scope

This contract defines the boundary between Agent Server's durable control plane and its external Execution Plane. Paseo is the primary implementation. Claude, Codex, OpenCode, and other provider runtimes remain behind Paseo.

## Source of truth

- Task and Run state are durable control truth.
- RuntimeWorkspace and RuntimeSession are durable execution identity/binding records.
- Paseo lifecycle is runtime observation, not a second Agent Server state machine.
- ExecutionRunRegistry is process-local cancellation reachability only.

## ExecutionPlanePort

The Application-facing plane contract is:

- capabilities()
- createSession(spec)
- attachSession(binding, spec)
- health()
- close()

createSession and attachSession are deliberately separate. An attach failure must fail explicitly and must never silently create a replacement external Agent.

The Plane exposes neutral bindings:

- ExecutionWorkspaceBinding { plane, externalWorkspaceId }
- ExecutionSessionBinding { plane, externalSessionId }

Application code must not use Paseo database-column names or raw wire identities.

## ExecutionSession

ExecutionSession is a process-local handle to one external execution session. It exposes:

- capabilities
- run({ runId, prompt }, observer?)
- optional cancel(runId)
- close()

close() releases process-local resources only. It does not archive or destroy the durable external session.

## Session creation ordering

For sticky ProductSession and TeamMember sessions:

1. durable RuntimeSession already exists;
2. the Execution Plane creates the external Workspace/Session when needed;
3. the Plane returns neutral bindings;
4. RuntimeSessionRepository persists both bindings;
5. only after persistence succeeds may the first prompt be sent.

Binding persistence failure therefore cannot produce an unrecorded first Turn.

## RuntimeWorkspace

RuntimeWorkspace is scoped to ProductSession or TeamRun. A TeamRun's members share one external Workspace while each TeamMember owns a distinct RuntimeSession/RuntimeCell/external Agent.

The first refactor round keeps the existing PostgreSQL schema. Infrastructure repositories translate existing paseo_workspace_id/provider_agent_id columns into neutral bindings; those column names do not escape Infrastructure.

## RuntimeSession policy

The compatibility policy is explicit and centralized:

- ProductSession: sticky
- TeamMember: sticky
- standalone Task: fresh

No generation replacement or background reconciler is introduced in this round.

## Turn result

Expected Turn completion is a result union:

- completed
- failed
- cancelled

Provider/daemon transport failure, invalid/unavailable durable binding, unsupported capability, and protocol violation remain explicit exceptions.

## Observation

ExecutionObservation is the only runtime observation shape consumed by Application. It represents assistant/reasoning updates, tool activity, nested child activity, permission activity, usage, and Turn lifecycle.

PaseoObservationProjector owns stream/timeline/subagent reduction and safe boundary normalization. Application then projects ExecutionObservation into RunEvent. Memory candidate collection is downstream and is not owned by the Execution Plane.

## Capability negotiation

Plane capabilities and Session capabilities are separate. Optional behavior is guarded through explicit capability negotiation rather than provider-name conditionals.

## Forbidden responsibilities

Execution Plane implementations must not own:

- Work, Task, Run, ProductSession, Team, or Memory persistence;
- provider-specific business branches in Application;
- UI projection or product vocabulary;
- automatic replacement of an unavailable bound session;
- a second durable running/idle state machine.

## Paseo version

This refactor does not upgrade Paseo. The repository remains pinned to @getpaseo/client 0.1.110. Provider-native mode values required by that SDK are isolated in a small Paseo compatibility launch-policy seam.
`;
await writeFile('docs/contracts/runtime-contract.md', runtimeContract);

const componentsPath = 'docs/components.md';
let components = await readFile(componentsPath, 'utf8');
components = components.replaceAll('PaseoRuntimeAdapter', 'PaseoExecutionPlane');
components = components.replaceAll('paseo-runtime-adapter.md', 'paseo-execution-plane.md');
if (!components.includes('Execution Plane')) {
  components += `\n\n## Execution Plane boundary\n\nPaseo is the primary Execution Plane. RuntimeWorkspace owns ProductSession/TeamRun workspace binding, RuntimeSession owns sticky ProductSession/TeamMember session binding, and Run remains durable execution truth. See [Paseo Execution Plane](./components/paseo-execution-plane.md) and [Runtime Contract](./contracts/runtime-contract.md).\n`;
}
await writeFile(componentsPath, components);
