# Frontend architecture

## Canonical product surface

Agent Server has exactly one browser application:

```text
apps/web
  React 18
  Vite
  React Router
  Cumora-inspired coworker workspace shell
```

The previous Next.js application and the temporary `apps/web-vite` migration package are intentionally removed. Do not recreate a second frontend application, a second router/layout owner, or a Next.js BFF.

## Product information architecture

The current MVE shell exposes one Coworker Workspace with these first-class surfaces:

```text
Coworker Workspace
├── Conversations
├── Agents
├── Tasks
├── Boards
├── Work
└── Files
```

The surface responsibilities are explicit:

- `Conversations` owns the ongoing relationship and transcript with a long-lived Agent.
- `Agents` owns coworker identity and configuration.
- `Tasks` is the user-facing projection of durable backend `WorkItem` coordination commitments.
- `Boards` is a Kanban projection over the same WorkItems; it is not a second Task model.
- `Work` owns formal Work Definition / Work / WorkRun execution.
- `Files` exposes the existing coworker file surface.

A persisted Conversation message can create a WorkItem through an editable `Create task` affordance. The source Conversation/message is retained on the WorkItem. A WorkItem can then be assigned, discussed, organized on a Board, and promoted to a formal Work through the existing canonical Work application contract.

Formal Work completion is projected by the backend into WorkItem `in_review`. The frontend must never infer review completion from transcript text, runtime events, or visual status. A human explicitly moves the WorkItem from `in_review` to `done`.

A Work Card in Chat is still a bridge into the Work tab. Opening any Conversation, Task, Board, Work, Agent, or File changes selection inside the same application shell; it must not navigate to a second dashboard shell.

The Work tab preserves the useful Work product capabilities that existed before the frontend convergence:

- real Work list and create flow;
- Work detail and product status;
- start/continue Run actions exposed by the current Product API;
- latest and historical Runs;
- overview and Run trace;
- execution/session transcript views;
- Work Definition view/edit;
- bounded Artifact state until the Product API exposes the full Artifact surface.

The Cumora-derived `Rail` and desktop shell are the only visible layout owners. Tasks, Boards, Work, Agents, Files, and Conversations are feature content rendered inside that shell.

## Browser API boundary

The Vite client never receives service-account credentials. Browser-facing `/api/*` routes are hosted by the Agent Server Hono process and forward to authenticated `/api/v1/*` Product/Conversation/WorkItem contracts using a server-side service credential.

```text
Browser (Vite)
  -> /api/* browser-safe facade
  -> Agent Server process
  -> authenticated /api/v1/* contract
  -> Product / Conversation / WorkItem application layer
```

The facade must:

- keep credentials server-side;
- decode responses through bounded public schemas;
- strip unknown/internal fields;
- preserve tenant/workspace authorization from the authenticated upstream contract;
- use `no-store` for Product/Conversation/WorkItem state;
- fail closed if a required server-side browser credential is absent.

Do not put credentials in `VITE_*` environment variables: Vite can embed them into browser assets.

## Routing

Current routes are deep links into the same workspace shell:

```text
/                         Conversations
/conversations/:id        selected Conversation
/agents                    Agents
/agents/:agentId           selected Agent
/tasks                     Task List, no selection
/tasks/:workItemId         selected WorkItem
/boards                    Board list, default selection
/boards/:boardId           selected Board
/work                      Work tab, no selection
/work/:workId              selected Work
/files                     Files
```

Work sub-selection such as tab, Run, or session transcript uses query state where supported. Work opened from a Task may carry `from_task` only as navigation context; the backend WorkItem `linked_work_id` remains the durable relationship. A route is a shareable selection, not a separate product layout.

## Development

Canonical host-native commands remain:

```bash
pnpm run setup
pnpm doctor
pnpm dev
pnpm dev:runtime
```

Both development modes start the same Vite application on port `3001`. The Vite development proxy sends `/api` to the Agent Server API process, normally port `3000`.

Production-like Compose also has one `web` service. There is no `web-vite` service.

Useful checks:

```bash
pnpm web:check:types
pnpm web:check:architecture
pnpm web:build
pnpm test:web
pnpm test:web:canonical
```

`web:check:architecture` is the structural regression guard. It fails if the duplicate `apps/web-vite` tree, Next.js config/runtime dependencies, `server-only`, or the old coexistence configs return.

## Source-of-truth rule

Backend Work/Run/Conversation/WorkItem facts remain canonical. The frontend may format product states but must not create a second WorkItem/Work state machine, infer formal Artifacts from raw messages/tool output, or map a successful-looking transcript directly to `in_review`/`done`.

When adding a new frontend capability, prefer:

```text
existing Product/Conversation/WorkItem contract
-> bounded browser facade
-> Vite feature/store/component
```

rather than adding framework-specific server logic inside the frontend package.
