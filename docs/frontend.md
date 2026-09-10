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
├── Observe
└── Files
```

The surface responsibilities are explicit:

- `Conversations` owns the ongoing relationship and transcript with a long-lived Agent.
- `Agents` owns coworker identity and configuration.
- `Tasks` is the user-facing projection of durable backend `WorkItem` coordination commitments.
- `Boards` is a Kanban projection over the same WorkItems; it is not a second Task model.
- `Work` owns formal Work Definition / Work / WorkRun execution.
- `Observe` is a read-only cross-Work projection of the same Product WorkRun/Trace facts the Work tab already renders for one selected Work; it lists traced Runs and opens the existing Run Trace view, filterable by Agent participation and Product state. It introduces no new backend contract or Work/Run state.
- `Files` exposes the existing coworker file surface.

A persisted Conversation message can create a WorkItem through an editable `Create task` affordance. The source Conversation/message is retained on the WorkItem. A WorkItem can then be assigned, discussed, organized on a Board, and promoted to a formal Work through the existing canonical Work application contract.

Formal Work completion is projected by the backend into WorkItem `in_review`. The frontend must never infer review completion from transcript text, runtime events, or visual status. A human explicitly moves the WorkItem from `in_review` to `done`.

WorkItem dispatch messages appear as compact Task events in Conversations. The
event names the actor and recipient, links to the Task, and reads its current
status from the WorkItem API. Agent instructions remain available through an
explicit disclosure. An assignment event alone never implies a successful claim.

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

Work and Run use different presentation levels within `/work/:workId`.
Without a selected Run, the compact Work header shows the title, Active/Archived
record state, and Start Run. Its tabs contain a Work summary, Runs, the current
Definition, and the bounded Files placeholder. The summary is a record of the
Work's Definition, dates, and run count; it does not render execution results.
The directory uses the same record state and a run count, with
`.work-pane-scroll` owning scrolling for both the Work list and catalog.

Selecting `?run=:runId` opens a visually distinct Run surface with a breadcrumb
back to the Work and a chronological Run ordinal. Conversation, Trace, and
Result belong to that Run. The existing result/journey Overview renderer is
Run content, not the Work summary. Historical Definition deep links retain the
exact pinned version. Preparation chat is available only before a Work has any
Runs; the Run conversation surface requires the Run-scoped chat integration.
The Work directory and create surfaces offer no Coworker binding controls.

The current list contract has no aggregate Run count. The Work index reads all
pages of the existing Runs endpoint to produce exact counts and chronological
ordinals; failed reads do not become zero counts. Run row states come from the
existing Run detail projection, since Run summaries do not contain state.
These reads add per-Work/per-Run requests and are an MVE limitation for large
histories, not a new server-side aggregation contract.

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

### Surface availability

Not every deployment composes every product surface. When `AGENT_SERVER_PRODUCT_WORK_PLANE` is
`absent`, the Product Work HTTP surfaces are never installed, so `/api/works`, `/api/work-items`,
`/api/boards`, `/api/work-definitions`, `/api/skills` and
`POST /api/agents/:agentId/capabilities` have no upstream to forward to. Capability binding is
included because a Capability is a published Work Definition. The Skill catalog is included
because it exists to serve Work authoring: it lists the Skills an author may attach to a Work
Definition, so it is meaningless where Work cannot be authored. The Coworker roster and profile
stay reachable regardless — a Coworker is an identity, not an execution authority, and its Skill
chips are a read-only projection of the compiled Worker rather than a picker.

This is a statement about configuration, not about runtime reachability. A composed surface means
the routes are installed, never that an execution plane is currently reachable behind them.

The facade answers those paths with an explicit availability result rather than letting the
browser see the generic control-plane 404:

```json
HTTP 503
{ "error": { "code": "feature_unavailable", "message": "<browser-safe sentence>", "request_id": "..." } }
```

Two rules keep this honest:

- **Availability is asserted from configuration at registration time**, from the same config the
  composition root reads. The facade must never infer availability by inspecting an upstream
  response — a 404 cannot be told apart from a mistyped URL, and treating one as the other would
  launder real routing bugs into "feature off".
- **The browser must distinguish four load states**, never fewer: `loading`, `ready` (which may be
  legitimately empty), `unavailable`, and `error`. "You have nothing" may only be claimed from a
  successful load. `unavailable` offers no Retry, because a retry cannot succeed; `error` does.
  Controls that cannot succeed in the current state are disabled rather than offered.

`ApiTransportError.code` carries the upstream `error.code` to the client, and
`apps/web/src/api/feature-availability.ts` is the single place that recognises this condition.
Any client wrapper that re-wraps a transport error must preserve `code`, or the signal is lost —
this applies to mutation wrappers as well as read wrappers, and is guarded by
`apps/web/src/features/work/clients/errors.test.ts`.

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
/observe                   Observe tab; `?work=&run=` selects a traced Run,
                           `?agent=&status=` filter the list
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

## Language and copy

The browser application ships English and Simplified Chinese. `apps/web/src/i18n` is the whole
mechanism; there is no i18n library.

```text
apps/web/src/i18n/
  en.ts        English — the source of truth for the key vocabulary
  zh-CN.ts     Simplified Chinese — Record<MessageKey, string>
  index.ts     locale state, detection, storage, lookup, interpolation
  rich.tsx     sentences whose placeholders are React nodes
```

Three rules hold the layer together:

- **English defines the vocabulary.** `MessageKey` is `keyof typeof en`, and every other
  dictionary is a _total_ `Record<MessageKey, string>`. A key a translation forgot is
  `TS2739`; a key it misspelled is `TS2353`. Runtime lookup still falls back to English, so a
  stale bundle renders a mixed UI rather than an empty one.
- **Product nouns stay English in every locale** — Work, Run, Agent, Coworker, Board,
  Workspace. They name things in this product; a translated name is a second name for the same
  thing, and a reader would have to learn both.
- **The register matches the English, which is plain and direct.** The product says
  "Coworkers work on their own and with each other", so the Chinese says
  「同事各自工作，也彼此协作」— not 「智能体实例自主执行任务」.

The locale is a per-device choice in `localStorage` under `agent-server.locale`, detected from
the browser on a first visit (anything `zh*` resolves to `zh-CN`). It is not an account
preference: one language pushed onto every browser someone signs in from is the wrong default
for a person reading English at work and Chinese at home.

### Migrating a surface

1. Add the English strings to `en.ts` under a namespaced key (`conversations.list.empty`).
   Copy the existing literal exactly — a migration extracts copy, it does not reword it.
2. Add the Chinese to `zh-CN.ts`. `tsc` will not let you skip one.
3. In a component, `const t = useT()`. It re-renders on a language switch.
4. In module scope — a shared label table, a store that produces an error string — use the
   non-reactive `t()`. `App` subscribes to the locale at the root, which is what carries a
   switch down to callers that cannot subscribe themselves. A helper that a component calls
   during render should take the translator as its first argument instead, so the dependency
   is visible.
5. A sentence with markup inside it (`<strong>{name}</strong> assigned …`) is one template
   with `{placeholders}`, rendered through `useRichT()`. Never concatenate fragments in JSX:
   concatenation hard-codes English word order, and Chinese puts the same three nodes in a
   different order.
6. A label table stops being a frozen `const` and becomes a function, so it reads the current
   locale at call time.

### Known gap

`pnpm web:check:types` runs `tsc --noEmit` against a solution-style `tsconfig.json` with
`files: []` and project references, which checks nothing. The real command is
`tsc -p tsconfig.app.json --noEmit`, and it currently reports eight pre-existing errors
unrelated to translation. Until that is cleaned up, `apps/web/src/i18n/i18n.test.ts` asserts
dictionary parity at runtime so the guarantee is enforced by a command that actually runs.

## Source-of-truth rule

Backend Work/Run/Conversation/WorkItem facts remain canonical. The frontend may format product states but must not create a second WorkItem/Work state machine, infer formal Artifacts from raw messages/tool output, or map a successful-looking transcript directly to `in_review`/`done`.

When adding a new frontend capability, prefer:

```text
existing Product/Conversation/WorkItem contract
-> bounded browser facade
-> Vite feature/store/component
```

rather than adding framework-specific server logic inside the frontend package.
