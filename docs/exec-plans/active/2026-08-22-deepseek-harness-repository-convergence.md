# Repository Convergence Execution Plan

Status: active
Baseline: `master@77a6b5487c0cd27b37cbbe2022e7d69f3d930d00`
Roadmap: https://docs.google.com/document/d/1x450BH64SnPHZbK8hmZmM45N7mhVJlnmwtHgxBRjhRo/edit

## Objective

Converge Agent Server before new product feature work: durable RuntimeSession recovery, restart-safe MCP/grants, one production composition graph, clear capability ownership, feature-owned Vite frontend, and repository Skills/gates inspired by DeepSeek Harness.

## Non-goals

Do not add new Artifact/Schedule/IAM/provider/Lark product features, a second execution-plane adapter, a generic plugin framework, or a package-per-capability monorepo. Preserve `WorkDefinition -> Work -> WorkRun`, technical `Task -> Run`, Paseo behind the execution boundary, durable Team coordination, Memory governance and the single Vite Web app.

## Required phases

### R0 — Repository authority and gates

- add Agent Server-specific `.agents/skills` workflows;
- correct current-state architecture/docs drift;
- install change-scope, lint, dead-code, duplication, import and docs gates;
- remove duplicate package scripts and temporary phase naming guards.

### R1 — Runtime recovery

- stable RuntimeSession identity + provider generations;
- desired/applied spec revision;
- attach reconciliation outcome (`reused | reconfigured | replacement_required`);
- restart-safe runtime MCP endpoint or explicit endpoint epoch;
- durable runtime grant hash/scope/lifecycle authority;
- deterministic restart/rebind scenarios and runnable real-runtime canary.

### R2 — Delete-first simplification

- delete dead legacy/deprecated/test-only production seams;
- remove unused platform composition shell;
- require any remaining compatibility surface to have a production consumer, owner and removal condition.

### R3 — Single composition graph

- explicit construct/initialize/start/stop/dispose lifecycle;
- core/runtime/test/acceptance profiles share one builder;
- remove production debug-only options;
- freeze runtime tool contributions before start;
- split giant bootstrap orchestration.

### R4 — Capability ownership

- move modules to composition ownership;
- remove `src/platform` by rehoming types;
- split ResourceModule into Agent/Environment/WorkDefinition/Skill ownership;
- separate Memory/Work core from HTTP/MCP consumers;
- provider-specific normalization stays in adapter;
- typed DB ports and branded critical IDs;
- mechanical import-boundary checks.

### R5 — Frontend feature architecture

- app shell owns routing/layout only;
- Conversations/Work/Agents/Files/RunTrace own API/model/store/view behavior;
- split transport/decoder/model/view;
- remove migration-era CSS/source names;
- preserve typed Chat ↔ Work navigation.

### R6 — Final convergence

- run final simplification survey;
- update docs/contracts to final paths/current facts;
- run relevant deterministic gates/build/browser/PG tests;
- run environment-dependent runtime/golden-path/restart canaries when available;
- move this plan out of `active` with exact validation evidence;
- leave no implementation TODO/deferred placeholder created by this plan.

## Core runtime data contract

```ts
interface RuntimeSessionRecord {
  id: RuntimeSessionId;
  desiredRevision: number;
  currentGenerationId: RuntimeSessionGenerationId | null;
  status: 'pending' | 'ready' | 'reconciling' | 'replacement_required' | 'unavailable' | 'closed';
}

interface RuntimeSessionGeneration {
  id: RuntimeSessionGenerationId;
  runtimeSessionId: RuntimeSessionId;
  generation: number;
  providerSessionId: ProviderSessionId;
  appliedRevision: number;
  endpointEpoch: string;
  status: 'active' | 'superseded' | 'unavailable' | 'closed';
}

type AttachExecutionSessionOutcome =
  | { kind: 'reused'; session: ExecutionSession; appliedRevision: number }
  | { kind: 'reconfigured'; session: ExecutionSession; appliedRevision: number }
  | { kind: 'replacement_required'; reason: string };
```

A successful runtime resolution must establish `desiredRevision === activeGeneration.appliedRevision` and a current usable Agent Server MCP endpoint/grant. If that cannot be established, fail explicitly rather than returning a stale attached session.

## Progress

- [x] Google Drive roadmap written.
- [x] Branch created from merged PR #111 master.
- [ ] PR opened (GitHub requires this first branch commit before PR creation).
- [ ] R0 complete.
- [ ] R1 complete.
- [ ] R2 complete.
- [ ] R3 complete.
- [ ] R4 complete.
- [ ] R5 complete.
- [ ] R6 complete.

## Validation log

Record only commands actually run and distinguish local/tooling limitations from product failures. The implementing agent does not merge the PR; final acceptance/debugging belongs to the user.
