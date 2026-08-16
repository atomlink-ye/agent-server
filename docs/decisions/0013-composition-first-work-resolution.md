# ADR 0013 — Composition-first Work Resolution

Status: accepted for PR #73 MVE

## Context

Product Work must be able to execute one Agent or a bounded collaboration without making either shape the platform-wide execution model. A Work Definition may compose an Agent, Environment, immutable Memory versions, Skills, domain tools and platform capabilities. The technical Task/Run layer should receive one immutable result instead of repeatedly asking mutable registries what is current.

## Decision

Introduce a side-effect-free Work Definition resolution boundary:

```text
Work Definition source/version
        ↓
ResolveWorkDefinition
        ↓
ResolvedWorkDefinition
        ↓
WorkRun resolved-resource manifest
        ↓
Task admission / runtime execution
```

`ResolvedWorkDefinition` is the internal execution IR. It contains only exact published/versioned resources plus derived platform capabilities. Single-Agent and bounded-collaboration Work use the same IR and WorkRun manifest path.

### Resource ownership

- Agent instructions, Skills and domain Tool refs come from the exact AgentVersion.
- Environment is an explicit exact EnvironmentVersion on authored Work Definitions.
- Memory is an optional bounded list of exact immutable MemoryVersion refs.
- Collaboration and the Agent Server MCP are platform capabilities. They are not authored as user/domain tools.
- RuntimeSession and RuntimeWorkspace are runtime materializations. They are not Definition-global shared resources.

### Definition source and compatibility

New composition-first Work uses an immutable authored Work Definition source/version which references exact resource versions. Existing Work rows that point directly at a published ManagedAgent or Team version remain readable/executable as compatibility sources; they do not define the long-term product authoring contract.

### WorkRun snapshot

Before technical Task admission, a WorkRun resolves its current Definition version and persists one immutable resource manifest. The manifest includes the resolved Definition fingerprint plus every Agent, Environment, Memory, Skill, domain Tool and platform capability used by that WorkRun.

Execution reads this snapshot by root Task and verifies that subsequently loaded Agent Skills/tools, Environment and Memory still match it. Registry drift fails closed instead of silently changing an in-flight WorkRun.

### Runtime policy

Single-Agent authored Work uses a fresh task-scoped RuntimeSession and a run-scoped runtime workspace. Bounded collaboration keeps participant-scoped reusable RuntimeSession semantics and the existing Team-run workspace behavior. No RuntimeSession is shared at Definition scope.

Before Task admission, required Execution Plane capabilities are checked explicitly. Unsupported composition fails before provider/model execution.

### Product projection

A Product WorkRun/Run Trace no longer requires a TeamRun. For single-Agent Work, execution facts alone provide the captured Run/Events projection; WorkItems/Actors/Messages/Edges remain empty rather than manufacturing collaboration facts. Internal TeamRun and RuntimeSession identities remain implementation details.

## Consequences

The framework gains composition flexibility without a generalized DAG, nested teams, dynamic roster, second Execution Plane, scheduler or plugin marketplace. Future Product Definition APIs can publish into the authored Definition source seam without changing the resolution/execution core.

The MVE acceptance proof is deliberately narrow: deterministic resolver/admission tests, a real-PostgreSQL Definition→manifest path, one real-provider single-Agent Work path through the canonical runtime smoke, and the existing real-provider Agent Team smoke unchanged as the collaboration proof.
