# Product

Agent Server supplies the enterprise control plane missing from otherwise capable agent runtimes. Paseo can run a model, tools, files, and long conversations; the platform must add stable identities, durable intent, bounded teams, policy, private credentials, evidence, and channel-neutral review.

V1 does not replace Paseo. It makes Paseo one leaf-runtime adapter beneath a product model that remains stable when a process, provider session, channel, or worker changes.

## Product objects

| Object          | User meaning                                        | Platform meaning                                                                                                     |
| --------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Work Definition | Reusable declaration of what Work should do         | Immutable authored version resolved into exact Agents, Environment, Memory, Skills, Tools, and platform capabilities |
| WorkItem        | A lightweight Task shared by humans and Agents      | Durable coordination commitment before or around formal Work; never a technical execution Task                       |
| Board           | Shared Kanban organization for Tasks                | Workspace-scoped projection of WorkItems into ordered columns; it does not own execution                              |
| Work            | A durable objective or unit of ongoing work         | Stable Product identity pinned to an immutable Definition version                                                    |
| WorkRun         | One execution occurrence of a Work                  | Product execution identity with typed input and an immutable resolved resource manifest                              |
| Agent           | A long-lived research colleague                     | Stable identity plus immutable versioned definition                                                                  |
| Team            | A reusable bounded research group                   | Internal/reusable bounded collaboration definition and completion policy                                             |
| Workspace       | A long-lived research project                       | Members, sources, context, files, artifacts, memory, conversations, WorkItems, Boards, and Work                       |
| Session         | A continuous product conversation                   | Turn admission and transcript continuity; optional for Work                                                          |
| Task            | One formal execution-node invocation                | Canonical execution intent, genealogy, input snapshot, and completion contract                                       |
| Run             | One Task attempt                                    | Queue, activation, lease/fence, usage, retry outcome                                                                 |
| Runtime Session | Provider context for a leaf Agent                   | Replaceable binding between a Run and Paseo                                                                          |
| Artifact        | A formal deliverable                                | Immutable versions, files, evidence, sources, and lineage                                                            |

The formal execution path remains **Work Definition -> Work -> WorkRun -> Product state / Run Trace**. `WorkDefinition:apply` resolves and pins exact composition resources before execution. A WorkRun then admits the technical Task/Run tree that the control plane and Execution Plane use internally. Task, technical Run, TeamRun, MemberRun, RuntimeSession, and Paseo identities remain execution/audit facts rather than the primary Product routing model.

The coworker work-organization MVE adds a deliberately lighter path in front of formal execution:

```text
Conversation message
  -> WorkItem (UI label: Task)
  -> Task List / Board
  -> optional promotion to Work
  -> WorkRun
  -> WorkItem In Review
  -> human Done
```

The semantic boundary is non-negotiable:

```text
WorkItem = coordination commitment
Work     = durable product objective
Task     = technical execution-node invocation
Run      = one Task attempt
```

A WorkItem can exist without Work. Promotion uses the canonical Work application path and pins exactly one linked Work identity. Successful linked Work completion projects the WorkItem to `in_review`; it does not silently mark the coordination commitment `done`. Human review closes the WorkItem explicitly. Board state is a projection over WorkItems, not a second execution state machine.

This is still a Prove / MVE-first product implementation. The implemented path proves the product and architecture boundary; it does not claim production recovery, production identity, generalized workflow execution, or production isolation.

## Product principles

1. **Long-lived Agent, replaceable process.** Identity, version, workspace, memory, and history create continuity; a Paseo process does not.
2. **Capture work before formal execution.** Conversation work may first become a WorkItem so it is assignable, discussable, and visible without inventing a formal Work too early.
3. **Materialize intent before execution.** Accepted formal Work becomes a durable Work/WorkRun and exact resource manifest before the runtime is called; technical Task admission follows that Product snapshot.
4. **Control-plane teams.** Child Tasks, joins, approvals, budgets, retries, and lineage are durable control-plane state, not hidden runtime conversation.
5. **Credentials are capabilities.** Raw user tokens do not enter prompts, workspaces, ordinary shell environments, logs, or tool results.
6. **Evidence is a product object.** A completed research result must identify versions, tasks, runs, sources, and derived artifacts.
7. **Channels are adapters.** Web, API, Lark, schedule, and event triggers converge on authorized Product/Task admission rather than provider-specific orchestration.
8. **Reliability before ambient autonomy.** Explicit, bounded, observable work precedes proactive discovery or unbounded self-spawn.

## Milestones

| Milestone                | Boundary                                                                                                                | Release meaning                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Repository / Product MVE | Conversation -> WorkItem/Board -> Work Definition -> Work -> WorkRun -> Task/Run -> Paseo plus Developer API and Web | Architecture and product-experience proof only |
| Single-Agent Core        | Tenant, identity, credential broker, durable Work/Task/Run, Agent, Workspace, Artifact, Web/Lark                        | Internal platform milestone, not V1 Beta       |
| Team V1                  | Immutable Team graph, sequential/parallel join, approval, child lineage, bounded recovery                               | Required before V1 Beta                        |

The detailed product boundary is in [Vision and scope](product/vision-and-scope.md), user flow in [Users and journeys](product/users-and-journeys.md), and testable release classification in [Requirements and release scope](product/requirements-and-release-scope.md). The implemented WorkItem/Board HTTP boundary is documented in [Coworker work organization API](contracts/work-organization-api.md).
