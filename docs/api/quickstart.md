# Agent Server Developer API Quickstart

Status: MVE golden path

This is the canonical first-run Product API flow. A new developer should need only:

1. one `work.yaml`;
2. `AGENT_SERVER_BASE_URL`;
3. one service-account `AGENT_SERVER_TOKEN` already bound to a workspace;
4. the Product concepts **Definition -> Work -> Run**.

You do **not** manually import/publish a Worker, Environment, or Team in this flow. `WorkDefinition:apply` materializes inline authoring resources into immutable internal versions and hides the registry choreography.

## 1. Create `work.yaml`

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

## 2. Configure the connection

```bash
export AGENT_SERVER_BASE_URL=http://127.0.0.1:3000
export AGENT_SERVER_TOKEN='<service-account-token>'
```

Provider credentials remain runtime/environment concerns and must not be embedded in `work.yaml`.

## 3. Validate and plan

```bash
pnpm agentctl definition validate work.yaml
pnpm agentctl definition plan work.yaml
```

`validate` checks the author document without side effects. `plan` resolves existing immutable references and describes which inline resources will be materialized.

## 4. Apply the Definition

```bash
pnpm agentctl definition apply work.yaml
```

The result contains the stable Product `definition.id` and immutable `version.id`.

Equivalent canonical source converges to the same immutable version. A changed source creates a new Definition version. Apply uses a client idempotency key; the CLI derives a stable default from the file content unless one is supplied explicitly.

## 5. Run in one helper call

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

`run-definition` is a thin convenience helper over the normal Product APIs:

```text
apply Definition
-> create Work from DefinitionVersion
-> start WorkRun with typed input
```

It does not create a second server-side orchestration truth.

The command returns Product Definition/Version, Work, and WorkRun identities. Save `work.id` and `work_run.id` from the JSON response.

## 6. Observe and read Trace

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

## HTTP-only golden path

If you do not want the CLI, the resource sequence is:

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

## What the MVE intentionally does not include

This quickstart is a developer preview, not a claim of production public-SaaS readiness. It does not add OIDC/SCIM, public marketplace sharing, arbitrary secret APIs, webhooks/schedules, generated multi-language SDKs, billing/quotas, multi-region operation, or generalized DAG execution.
