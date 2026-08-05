# Design: Team ergonomics — cheap-to-author AgentProject declarations

Status: design authority for the Phase A slice. Phase B (roster/limit
parameterization) is covered by
`docs/exec-plans/active/2026-08-05-team-ergonomics.md` and is not re-specified
here.

## 1. Problem

Standing up a Team today costs five hand-authored files plus a publish
sequence: `agent-project.yaml`, one `agents/*.yaml` per member, a
`tool-profiles/*.yaml`, an `environments/*.yaml`, and a `teams/*.yaml`. Most of
what the author types carries no information.

Measured against the current validators (see §3), roughly **21 of ~38 required
fields are boilerplate** — either the validator admits exactly one legal value,
or there is an obvious safe default. The author is transcribing constants to
satisfy a schema.

The cost this imposes is not conceptual difficulty. It is transcription
volume, and it is what makes the platform feel heavy relative to calling a
local agent subsystem.

## 2. Design constraint that shapes everything below

agent-server is a **determinism-first internal platform**. The AgentProject
declaration is the authoritative, versioned, reviewable **boundary**: it
declares which agents exist, their tool profiles, their environment, their
skills, and the team roster. A Lead is spawned _from_ that declaration and has
latitude only _inside_ it — how to decompose work, how many Work items to
open, who gets what, accept vs. request changes, when to finish. A Lead must
never be able to widen its own boundary.

Two consequences, both binding:

- **The declarative artifact is kept.** The goal is to make it cheap to write,
  not to make it optional. Every path still produces the same published,
  versioned, fingerprinted artifacts.
- **Nothing is defined at invocation time.** An earlier draft of this slice
  proposed `POST /api/v1/teams:run` accepting inline member instructions and
  tools in the request body. That is **withdrawn and prohibited**: it
  constructs an ad-hoc boundary at call time and bypasses AgentProject as the
  single source of truth. A determinism-first platform must not have a "start
  a team without declaring a project" side door.

## 3. Findings this design rests on

All verified against the tree at `084f570` (read-only reference worktree).

**Entrypoint launch is already wired — not new work.**
`src/entrypoints/cli/agentctl.ts:174-209` implements `run [team-ref]`: it
falls back to `project.defaultEntrypoint` (`:191`), validates membership in
`project.entrypoints` (`:192`), resolves `teamVersionId` from the lock
(`:194`), and calls `controlPlane.invokeTeam(...)` (`:203`). The binding is
written at apply time (`src/application/projects/apply-agent-project.ts:400-406`)
into `lock.entrypoints` (`src/domain/projects/agent-project-lock.ts:40-43`).

_This corrects an earlier assumption that `entrypoints` was declarative-only._
"One call to launch a declared team entrypoint" already exists. Phase A must
not rebuild it.

**Single-legal-value fields (category a) — 13 total.**
`ManagedEnvironment`: `adapter=paseo`, `provider=opencode`,
`modelPolicyRef=free-only`, `runtimeCellPolicy=per_runtime_session`
(`managed-environment-package.ts:91-97`) — the entire file is constants.
`ManagedAgent`: `runtime.provider=paseo` (`:216`),
`runtime.modelPolicyRef=free-only` (`:219-223`),
`session.invocation=fresh_per_invocation` / `session.followUps=queued` /
`session.binding=reusable` (`:263-265`), `memory.policy=workspace_snapshot`
(`:272`), `completion.type=executable` (`:291`).
`ManagedTeam`: `coordination.taskAssignment=lead_or_self_claim` (`:258`).

**Safely-defaultable fields (category b) — ~8 total**, e.g.
`runtime.mode` → `isolated`, `permissions.network` → `none`,
`permissions.filesystem` → `none`, `skills` → `[]`, `memoryStores` → `{}`.
At the project-manifest level, absent `toolProfiles`, `skills`, and
`memoryStores` sections normalize to empty maps; an empty map grants nothing.

**Genuine author intent (category c)** — `description`, `instructions`,
`input.prompt`/`input.schema`, roster names and agent bindings, workspace
name, skill directories, and `completion.command`. These stay mandatory.
Reducing ceremony must not reduce the amount of _thinking_ the author does;
`instructions` is where all behavior lives.

**Inline sections are already precedented.** `skills` and `memoryStores` are
parsed inline from the manifest
(`local-agent-project-loader.ts:392-414`, `:428-461`), while `environments`,
`agents`, and `teams` are forced through `simple()` which admits only a
`file:` key (`:416-426`). Adding an inline form to those three sections
follows an existing pattern in the same parser rather than inventing one.

**Tool profiles are client-side only.** They are never sent to the control
plane — `apply-agent-project.ts:79-88` records every profile as `NoOp`; the
lock stores only `{ref, sourceFingerprint, tools[]}`
(`agent-project-lock.ts:15-19`). `tool-profile://x` is expanded into concrete
tool refs client-side at `render-project-agent.ts:126-141` before the agent
YAML is submitted. There is no server-side ToolProfile resource to default.

**There is exactly one canonicalization funnel.**
`local-agent-project-loader.ts:318-319` computes `canonicalizeManifest(...)`
and `fingerprintProject(...)` at the end of loading, after which the
normalized project is frozen (`:306`).

## 4. Design

Three changes, all in the authoring/loading layer. No change to published
artifact shape, no change to the control plane, no new HTTP surface, no
migration.

### 4.1 Defaults for boilerplate fields

Make every category-(a) field optional in the loader, filling the single legal
value when absent. Apply defensible category-(b) defaults (`runtime.mode`
→ `isolated`, both `permissions` → `none`, `skills` → `[]`).

Validators are **not** relaxed. They keep rejecting a wrong explicit value;
they simply stop requiring the author to type the only right one.

### 4.2 Inline `agents` / `environments` / `teams`

Extend `simple()` so each entry accepts either `{file: <path>}` (unchanged) or
an inline spec, mirroring how `skills`/`memoryStores` already parse. A small
project collapses from five files to one. A large project keeps using files.
Both forms must produce byte-identical normalized output.

### 4.3 Built-in team role tool profiles

The tempting default — `tools: []` — is a trap. An agent published with no
tools yields an empty `allowedTools` after the policy intersection
(`team-policy-evaluator.ts:156-160`), so the Lead can never issue a command
and the run dies at `lead_no_progress` (`team-driver.ts:218-242`). That
failure is indistinguishable from model flake at runtime.

Silently auto-injecting team tools is equally wrong: it would let the boundary
widen without the author declaring it.

Resolution: ship **built-in tool profile refs for the team lead and member
roles**, derived from the existing `canonicalTeamToolRefsForRole`
(`team-policy-evaluator.ts:99-117`). The author writes one explicit ref
instead of enumerating tools. The grant stays visible and declared in the
artifact — ceremony drops, explicitness does not.

## 5. Correctness property this slice must preserve

**Fingerprint equivalence.** A fully-explicit project and a short project that
means the same thing must produce the _same_ fingerprint and the _same_
published artifacts. Defaults therefore must be applied **before**
`canonicalizeManifest`/`fingerprintProject` at
`local-agent-project-loader.ts:318-319`, during or immediately after manifest
parsing (`:341-496`, normalization at `:279-305`).

Applying a default after that line, or in a downstream renderer, would make
the same logical project fingerprint differently depending on how verbosely it
was written — silently breaking apply/lock convergence. This is the single
highest-risk property in the slice.

## 6. Non-goals

- No `POST /api/v1/teams:run` or any inline-team invocation path. Withdrawn
  as contrary to §2.
- No new entrypoint-launch mechanism. It already exists (§3).
- No migration. Phase A touches no durable state or schema.
- No relaxation of what a validator considers legal — only of what the author
  must type.
- No new test suites; per repository work protocol, existing checks are
  supporting signals only.
- Deferred, unchanged: `execute-run.ts` → `TeamDriver` consolidation, the dead
  `phase` state machine, `work_ref` stable identifiers, breaking the Lead-turn
  barrier, and Lead corrective actions (cancel/reassign). Lead corrective
  actions remain the strongest candidate for the next slice, since they are
  the in-boundary runtime latitude that §2 endorses.

## 7. Acceptance

The real main-flow observation for this slice: **a single-file
`agent-project.yaml` declaring a three-member team, applied and launched
through the existing entrypoint path, reaching terminal state against a real
model** — with the resulting published artifacts and project fingerprint
identical to those produced by the equivalent fully-explicit five-file
project.

That equality is the acceptance signal that ergonomics improved without the
boundary weakening.
