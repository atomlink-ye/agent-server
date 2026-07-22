# Product

Agent Server supplies the enterprise control plane missing from otherwise capable agent runtimes. Paseo can run a model, tools, files, and long conversations; the platform must add stable identities, durable intent, bounded teams, policy, private credentials, evidence, and channel-neutral review.

V1 does not replace Paseo. It makes Paseo one leaf-runtime adapter beneath a product model that remains stable when a process, provider session, channel, or worker changes.

## Product objects

| Object          | User meaning                      | Platform meaning                                                     |
| --------------- | --------------------------------- | -------------------------------------------------------------------- |
| Agent           | A long-lived research colleague   | Stable identity plus immutable versioned definition                  |
| Team            | A reusable bounded research group | Immutable graph/version plus completion and failure policy           |
| Workspace       | A long-lived research project     | Members, sources, context, files, artifacts, and memory              |
| Session         | A continuous product conversation | Turn admission and transcript continuity; optional for tasks         |
| Task            | One formal node invocation        | Canonical intent, genealogy, input snapshot, and completion contract |
| Run             | One Task attempt                  | Queue, activation, lease/fence, usage, retry outcome                 |
| Runtime Session | Provider context for a leaf Agent | Replaceable binding between a Run and Paseo                          |
| Artifact        | A formal deliverable              | Immutable versions, files, evidence, sources, and lineage            |

The baseline currently implements only a transient Run-shaped seam so the API/runtime boundary can be tested. The V1 canonical entrypoint remains Task invocation; the baseline must evolve into it rather than create a permanent second invocation model.

## Product principles

1. **Long-lived Agent, replaceable process.** Identity, version, workspace, memory, and history create continuity; a Paseo process does not.
2. **Materialize intent before execution.** Accepted work must become durable Task state before a runtime is called.
3. **Control-plane teams.** Child Tasks, joins, approvals, budgets, retries, and lineage are durable control-plane state, not hidden runtime conversation.
4. **Credentials are capabilities.** Raw user tokens do not enter prompts, workspaces, ordinary shell environments, logs, or tool results.
5. **Evidence is a product object.** A completed research result must identify versions, tasks, runs, sources, and derived artifacts.
6. **Channels are adapters.** Web, API, Lark, schedule, and event triggers enter one authorization and Task admission path.
7. **Reliability before ambient autonomy.** Explicit, bounded, observable work precedes proactive discovery or unbounded self-spawn.

## Milestones

| Milestone           | Boundary                                                                                    | Release meaning                                  |
| ------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Repository baseline | HTTP → Port → Paseo → OpenCode plus docs/tests                                              | Architecture and developer-experience proof only |
| Single-Agent Core   | Tenant, identity, credential broker, durable Task/Run, Agent, Workspace, Artifact, Web/Lark | Internal platform milestone, not V1 Beta         |
| Team V1             | Immutable Team graph, sequential/parallel join, approval, child lineage, bounded recovery   | Required before V1 Beta                          |

The detailed product boundary is in [Vision and scope](product/vision-and-scope.md), user flow in [Users and journeys](product/users-and-journeys.md), and testable release classification in [Requirements and release scope](product/requirements-and-release-scope.md).
