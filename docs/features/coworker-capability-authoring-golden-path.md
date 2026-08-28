# Coworker & Capability authoring Golden Path

Status: implemented on PR #121; final validation in progress.

Canonical implementation Roadmap:

https://docs.google.com/document/d/1CQwxxUXbG0pqQj6Dbn-j2bdmrgily8mCMvuEksf5ZXY/edit

This document is the repository-local execution map for the Product authoring slice. It is intentionally sufficient to understand the active contracts and acceptance criteria even when the Workspace Roadmap is unavailable.

## Product rule

The Coworker / Worker ontology from PR #119 remains unchanged:

```text
Coworker
= AgentDefinition + active AgentVersion
= long-lived Chat identity

Capability / “Can do”
= WorkDefinition + AgentWorkBinding
= reusable formal job exposed by a Coworker

WorkerDefinition / WorkerVersion
= formal execution role behind Work

Work
= one concrete user order

Run
= one WorkRun execution occurrence
```

Normal users must not need to copy a WorkerVersion UUID, author JSON Schema, understand TeamVersion/RuntimeSession, or paste YAML merely to create a Coworker or start Work. Canonical Agent/Worker/WorkDefinition packages remain authoritative underneath the friendly UI.

## Golden Path

The primary Product path is:

```text
Agents → New Coworker
→ name / role / summary / working style
→ Create & Chat
→ canonical ManagedAgent validate/import/publish
→ idempotent Direct Conversation

Coworker profile
→ Can do
→ Add capability
→ name / outcome / specialist or small team / typed inputs
→ deterministic WorkDefinition source
→ validate + plan
→ human-readable Plan Preview
→ apply immutable WorkDefinitionVersion
→ exact AgentWorkBinding

Start Work
→ select Coworker
→ select exact Capability version
→ generated typed input form
→ create Work
→ start WorkRun
→ existing Work Card / Work Detail / Run Trace
```

Raw WorkDefinition source remains an explicitly **Advanced** developer escape hatch. It re-enters the same `validate → plan → apply` pipeline; it is not a second authoring authority.

## Server implementation

### Friendly Coworker compiler

`src/application/agents/coworker-authoring.ts`

`compileCoworkerDraft()` converts the bounded Product draft into the existing immutable ManagedAgent package. Required package fields that are not meaningful first-run choices use supported MVE defaults. The generated package includes the Product Work discovery/start tools so the resulting Coworker can reason about its Work Catalog and start formal Work.

`src/application/agents/import-agent.ts` accepts optional identity-owned `roleLabel` and `summary` from the Product facade. Executable behavior remains in the immutable AgentVersion package; human-facing profile metadata remains on AgentDefinition.

### Canonical Coworker create route

`POST /api/v1/coworkers`

Implemented by `src/entrypoints/api/routes/coworker-authoring.ts`.

The route:

1. validates the bounded friendly draft;
2. deterministically compiles ManagedAgent source;
3. validates the canonical package;
4. imports idempotently;
5. publishes idempotently;
6. provisions the Direct Conversation through the existing Coworker lifecycle service;
7. returns only Agent, AgentVersion, and Conversation identities needed by the Product client.

The authenticated server derives tenant/workspace/principal authority. The browser never supplies owner scope.

### Work Catalog

Coworker profile reads authoritative `AgentWorkBinding` records through `listAgentWorkBindings`; it does not infer capabilities from Tool refs or Worker rows.

Profile projection includes bounded entries:

```text
definition_id
definition_version_id
name
description
input_schema
```

Capability association uses:

`POST /api/v1/agents/:agentId/capabilities`

The write enters the exact WorkDefinition lineage/scope checks established by semantic closure. The browser cannot persist an unchecked Definition/Version pair.

### Browser facade

`src/entrypoints/api/routes/browser-coworkers.ts` exposes browser-safe operations:

```text
GET  /api/agents
POST /api/agents
GET  /api/agents/:agentId/profile
POST /api/agents/:agentId/capabilities
```

The BFF owns service authentication and mutation idempotency keys. Responses are decoded through strict browser-safe schemas so provider/session/server credentials do not leak into Vite.

## Frontend implementation

### Agents / Coworker profile

`apps/web/src/features/agents/AgentsPage.tsx`

The Agents surface now supports:

- empty-roster onboarding;
- New Coworker;
- Create & Chat;
- profile identity/role/summary/availability;
- first-class `Can do` / Capability cards;
- Add capability;
- Start Work from a Capability;
- runtime/version/model/tool/skill metadata under an Advanced disclosure instead of as the main profile.

### Capability Builder

`apps/web/src/features/agents/AuthoringPanels.tsx`
`apps/web/src/features/agents/authoring.ts`

The builder supports the bounded MVE WorkDefinition authoring surface:

- one specialist;
- bounded collaboration with one lead plus members;
- participant name, role, and instructions;
- string/text input;
- enum/choice input;
- number input;
- integer input;
- boolean input;
- required/optional fields;
- supported string and numeric bounds.

The deterministic compiler emits only Worker vocabulary:

```text
single_worker / collaboration
inline Worker source
inline ManagedEnvironment source
bounded input_schema
```

It never emits `single_agent` or `agent_version_id` for formal Work composition.

The Preview step calls the canonical side-effect-free WorkDefinition `validate` and `plan` operations. The Product preview renders real resolved participants, Tools, Skills, platform capabilities, and input summary. Generated canonical source is inspectable under Advanced.

Save performs:

```text
apply WorkDefinition
→ published immutable WorkDefinitionVersion
→ associate exact version with selected Coworker
```

`Save & start Work` continues into the New Work flow using that exact version.

### Capability-driven New Work

`apps/web/src/features/work/components/new-work.tsx`

The default New Work flow no longer authors/publishes a WorkDefinition as a hidden side effect. It loads Coworkers and each Coworker’s authoritative Work Catalog, then renders typed inputs from the selected immutable Capability version.

Execution order is explicit:

```text
validate friendly input locally
→ create Work with exact Definition + DefinitionVersion
→ start WorkRun with typed input
```

Product errors distinguish “Work was not created” from “Work exists but its first Run did not start.” The latter preserves a link to the durable Work.

`apps/web/src/features/work/WorkPage.tsx` accepts deep links containing the intended Coworker and Capability, so `Start Work` and `Save & start Work` enter the same canonical form.

The raw-source Definition form remains inside Advanced and uses the same existing WorkDefinition clients.

## Deterministic contract boundaries

Two authoring draft models exist only as UI/application inputs:

```text
CoworkerDraft
→ compileCoworkerDraft()
→ ManagedAgent source
→ canonical Agent validation/import/publish

CapabilityDraft
→ compileCapabilityDraft()
→ WorkDefinition source
→ canonical validate/plan/apply
```

Neither draft is stored as a competing domain object. A generated source that does not pass the canonical validator cannot become authoritative.

## Regression evidence

Focused evidence added by this feature includes:

- `src/application/agents/coworker-authoring.test.ts`
  - generated Coworker package is accepted by the canonical import parser;
  - identity instructions include Role/Profile intent;
  - default Work tools are present and deduplicated.

- `src/application/work/capability-authoring.test.ts`
  - structured single-specialist draft round-trips through canonical WorkDefinition validation;
  - every supported typed-input shape is exercised through WorkRun input validation;
  - inline Worker and Environment packages validate through their canonical parsers;
  - collaboration remains Worker-only;
  - compilation is deterministic.

- `src/entrypoints/api/routes/browser-coworkers.test.ts`
  - browser-safe roster;
  - Create Coworker forwarding/auth/idempotency/response sanitization;
  - Work Catalog projection;
  - Capability binding;
  - fail-closed behavior without a service credential.

Existing scenario, real-Postgres, Work Card, Work projection, and Chat lanes remain the broader regression authority in CI. Real-provider coverage is no longer a CI lane; it is a named Sandbox/local live canary (see `docs/quality/ci-fixture-successors.md`). Final PR validation must be green on the PR head before this document is marked Validated.

## Acceptance matrix

The feature is complete only when all statements hold:

- **G1**: an empty roster can create a Coworker without YAML and `Create & Chat` opens its Direct Conversation;
- **G2**: a Coworker profile exposes authoritative `Can do` entries and can add a new Capability;
- **G3**: a structured Capability previews the real canonical plan before save;
- **G4**: single-specialist and bounded-collaboration Capabilities compile entirely through Worker semantics;
- **G5**: Work starts from an exact selected Capability version with generated typed inputs;
- **G6**: invalid friendly input is rejected before a junk Work is created, and invalid server input still cannot invoke the provider;
- **G7**: Work-create failure and WorkRun-start failure are distinct Product states in the UI;
- **G8**: existing Chat → Work Card → Work Detail / Run Trace behavior remains intact;
- **G9**: normal Golden Path screens do not require raw YAML, JSON Schema, UUID copy/paste, WorkerVersion, TeamVersion, or RuntimeSession terminology;
- **G10**: Advanced source inspection/editing uses the same canonical validator/planner/apply path;
- **G11**: no Worker created for a Capability appears in the Coworker roster or receives a Direct Conversation;
- **G12**: repository docs and the Product UI describe the same Coworker / Capability / Work / Run model.

## Explicit non-goals

This feature does not redesign the Agent/Worker ontology, RuntimeSession/Generation/Turn substrate, generalized DAG/nested Teams, production IAM/RBAC, public Worker marketplace, Artifact/Evidence, proactive scheduling, or the design system. Those are outside this feature; they are not missing implementation steps inside this Roadmap.
