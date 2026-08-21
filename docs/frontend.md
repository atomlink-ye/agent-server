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

The current MVE shell has two first-class product tabs:

```text
Coworker Workspace
├── Conversations
└── Work
```

`Conversations` owns the relationship with the Agent. `Work` owns formal execution.

A Work Card in Chat is a bridge into the Work tab. Opening it must select the referenced Work inside the same application shell; it must not navigate to a second dashboard shell. Returning to the originating conversation likewise changes product selection rather than switching applications.

The Work tab preserves the useful Work product capabilities that existed before the frontend convergence:

- real Work list and create flow;
- Work detail and product status;
- start/continue Run actions exposed by the current Product API;
- latest and historical Runs;
- overview and Run trace;
- execution/session transcript views;
- Work Definition view/edit;
- bounded Artifact state until the Product API exposes the full Artifact surface.

The Cumora-derived `Rail` and desktop shell are the only visible layout owners. Work-specific components are feature content rendered inside that shell.

## Browser API boundary

The Vite client never receives service-account credentials. Browser-facing `/api/*` routes are hosted by the Agent Server Hono process and forward to the authenticated `/api/v1/*` Product/Conversation contracts using a server-side service credential.

```text
Browser (Vite)
  -> /api/* browser-safe facade
  -> Agent Server process
  -> authenticated /api/v1/* contract
  -> Product / Conversation application layer
```

The facade must:

- keep credentials server-side;
- decode responses through bounded public schemas;
- strip unknown/internal fields;
- preserve tenant/workspace authorization from the authenticated upstream contract;
- use `no-store` for Product/Conversation state;
- fail closed if a required server-side browser credential is absent.

Do not put credentials in `VITE_*` environment variables: Vite can embed them into browser assets.

## Routing

Current routes are deep links into the same workspace shell:

```text
/                 Conversations
/work             Work tab, no selection
/work/:workId     Work tab, selected Work
```

Work sub-selection such as tab, Run, or session transcript uses query state where supported. A route is a shareable selection, not a separate product layout.

## Development

Canonical host-native commands remain:

```bash
pnpm setup
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

Backend Work/Run/Conversation facts remain canonical. The frontend may format product states but must not create a second Work state machine or infer formal Artifacts from raw messages/tool output.

When adding a new frontend capability, prefer:

```text
existing Product/Conversation contract
-> bounded browser facade
-> Vite feature/store/component
```

rather than adding framework-specific server logic inside the frontend package.
