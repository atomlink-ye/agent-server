# Agent Server Golden Path Quickstart

Status: MVE golden path

Agent Server now has two views of the same canonical Product contracts:

- the **Product UI Golden Path**, which is the recommended first experience;
- the **Developer API path**, which exposes the underlying immutable authoring contracts for automation and debugging.

They do not create separate domain objects. Friendly Coworker and Capability drafts compile into the same Agent and WorkDefinition contracts used by the API.

## Product UI Golden Path

A first-time user should not need YAML, JSON Schema, WorkerVersion IDs, TeamVersion IDs, or RuntimeSession details.

### 1. Create a Coworker

Open **Agents** and choose **New Coworker**.

Enter:

- Name, for example `Maya`;
- Role, for example `Research Analyst`;
- what the Coworker should help with;
- optional working-style instructions.

Choose **Create & Chat**.

The server deterministically compiles the draft into the canonical ManagedAgent package, validates/imports/publishes the Agent, idempotently provisions its Direct Conversation, and opens that Conversation. Runtime/package controls remain under **Advanced** rather than being required first-run input.

### 2. Teach the Coworker a Capability

On the Coworker profile, use **Can do → Add capability**.

A Capability is the user-facing form of a reusable WorkDefinition. The builder asks for:

1. capability name and expected outcome;
2. one specialist or a bounded small team;
3. friendly participant names, roles, and instructions;
4. typed input fields such as Text, Choice, Number, Integer, and Yes/No.

The UI deterministically generates a Worker-based WorkDefinition with inline Worker/Environment authoring sources. It does not publish Workers as Coworkers or put them in the Conversation roster.

### 3. Preview before saving

Choose **Preview plan**.

The preview is produced by the canonical side-effect-free WorkDefinition `validate` and `plan` operations. It shows the real resolved execution mode, participants, Tools, Skills, platform capabilities, and input contract.

The generated canonical source is available under **Advanced** for inspection. It is not a second source of truth and still passes through the same validator/planner/apply pipeline.

Choose either:

- **Save capability** to add the exact published WorkDefinitionVersion to the Coworker Work Catalog; or
- **Save & start Work** to save it and open the New Work flow immediately.

### 4. Start formal Work

Open **Work → New Work**, or choose **Start Work** on a Coworker Capability.

Select:

```text
Coworker
→ Capability
→ typed input
→ Start Work
```

The browser uses the exact selected WorkDefinitionVersion. It first creates the durable Work, then starts the first WorkRun with the typed input. These are separate operations: if Work creation fails, no Work exists; if the Work is created but the Run fails to start, the UI says so and keeps a link to the created Work.

The existing Work Card, Work Detail, result, Run Trace, and Conversation-origin navigation continue to represent canonical Product state.

### 5. Advanced raw source

Raw WorkDefinition YAML/JSON authoring remains available only as an explicitly **Advanced** developer escape hatch. It continues to execute:

```text
validate
→ plan
→ apply immutable DefinitionVersion
→ create Work
```

The default New Work path does **not** publish a Definition as a hidden side effect.

---

## Developer API path

For automation or contract-level development, a new developer needs:

1. one `work.yaml`;
2. `AGENT_SERVER_BASE_URL`;
3. one service-account `AGENT_SERVER_TOKEN` already bound to a workspace;
4. the Product concepts **Definition → Work → Run**.

You do **not** manually import/publish a Worker, Environment, or Team in this path. `WorkDefinition:apply` materializes inline authoring resources into immutable internal versions and hides the registry choreography.

### Create `work.yaml`

```yaml
apiVersion: agentserver.dev/v1alpha1
kind: WorkDefinition
metadata:
  name: quickstart-research
  description: Answer the requested research question concisely.
spec:
  kind: single_worker

  worker:
    source: |
      apiVersion: agent-server/v1alpha1
      kind: Worker
      metadata:
        name: quickstart-research-worker
      spec:
        description: Product API quickstart Worker
        instructions: "Answer the Product Work input directly and concisely."
        runtime:
          provider: paseo
          modelPolicyRef: free-only
          mode: isolated
        tools: []
        skills: []
        input:
          schema:
            type: object
            properties: {}
            additionalProperties: false
          prompt: "Follow the Product Work input."
        session:
          invocation: fresh_per_invocation
          followUps: queued
          binding: reusable
        memory:
          policy: workspace_snapshot
          proposalLimit: 0
        permissions:
          network: none
          filesystem: none
        completion:
          type: executable
          command: "done"

  environment:
    source: |
      apiVersion: agent-server/v1alpha1
      kind: ManagedEnvironment
      metadata:
        name: quickstart-paseo
      spec:
        adapter: paseo
        provider: opencode
        modelPolicyRef: free-only
        runtimeCellPolicy: per_runtime_session

  memory_version_ids: []

  input_schema:
    type: object
    properties:
      question:
        type: string
        min_length: 1
        max_length: 4000
    required: [question]
    additional_properties: false
```

The inline Worker and Environment are convenience authoring objects. After `apply`, execution is pinned to immutable internal versions just like advanced registry-authored resources.

### Configure the connection

```bash
export AGENT_SERVER_BASE_URL=http://127.0.0.1:3000
export AGENT_SERVER_TOKEN='<service-account-token>'
```

Provider credentials remain runtime/environment concerns and must not be embedded in `work.yaml`.

### Validate, plan, and apply

```bash
pnpm agentctl definition validate work.yaml
pnpm agentctl definition plan work.yaml
pnpm agentctl definition apply work.yaml
```

`validate` checks author intent without side effects. `plan` resolves existing immutable references and describes inline resources. `apply` publishes the immutable Product DefinitionVersion.

Equivalent canonical source converges to the same immutable version. Changed author intent creates a new Definition version.

### Run in one helper call

Create `input.json`:

```json
{ "question": "In one sentence, explain why durable task identity matters." }
```

Then:

```bash
pnpm agentctl work run-definition work.yaml \
  --title "Quickstart research" \
  --input input.json
```

`run-definition` remains a thin convenience helper over the normal Product APIs:

```text
apply Definition
→ create Work from DefinitionVersion
→ start WorkRun with typed input
```

It does not create a second server-side orchestration truth.

### Observe and read Trace

```bash
pnpm agentctl work watch <work-id> <work-run-id>
pnpm agentctl work trace <work-id> <work-run-id>
```

The same operations are available directly over HTTP:

```text
GET /api/v1/works/{work_id}/runs/{work_run_id}
GET /api/v1/works/{work_id}/runs/{work_run_id}/trace
```

The Product surface uses Work/WorkRun identity. Technical Task/Run IDs appear only in explicit `source_refs` for audit/debug.

### HTTP-only resource sequence

```text
POST /api/v1/work-definitions:validate
POST /api/v1/work-definitions:plan
POST /api/v1/work-definitions:apply
POST /api/v1/works
POST /api/v1/works/{work_id}/runs
GET  /api/v1/works/{work_id}/runs/{work_run_id}
GET  /api/v1/works/{work_id}/runs/{work_run_id}/trace
```

All Product endpoints use the same bearer service-account authentication convention.

## MVE boundary

This quickstart does not claim production public-SaaS readiness. It does not add OIDC/SCIM, marketplace sharing, arbitrary secret APIs, webhooks/schedules, generated multi-language SDKs, billing/quotas, multi-region operation, generalized DAG execution, or formal Artifact/Evidence delivery.
