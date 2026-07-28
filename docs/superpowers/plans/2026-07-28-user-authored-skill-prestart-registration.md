# User-authored Skill Pre-start Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator register Skills from an Agent project directory before
provider-Agent creation, reference those Skills from a managed Agent package,
and prove one pre-registered Skill through a newly created provider Agent.

**Architecture:** Generalize the existing immutable filesystem Registry behind a
`SkillCatalogPort`, add one local project registration entrypoint, and make Agent
resolution produce a digest-pinned extension snapshot consumed by the existing
create-only Runtime binder. Logical refs remain mutable pointers; immutable
objects are projected before provider creation. Old/new digest coexistence across
multiple retained provider Agents is explicitly deferred.

**Registration boundary:** The local project is operator-controlled and must be
quiescent during registration. This MVE is single-writer per Registry root;
atomic ref replacement protects concurrent readers, while competing writer
commands and adversarial source-directory replacement are deferred. A future
upload API must use server-controlled, non-mutable staging.

**Tech Stack:** TypeScript 7, Node.js 24, pnpm, YAML, Zod, PostgreSQL 16, Paseo
0.1.110, OpenCode 1.18.4.

**Authority:**
`docs/superpowers/specs/2026-07-28-user-authored-skill-prestart-registration-design.md`
and
`docs/exec-plans/completed/2026-07-28-platform-extension-injection-mve-ext1.md`.

**Execution constraint:** Do not commit, push, create a PR, merge, or remove the
worktree. The user explicitly chose to keep this branch as an uncommitted
worktree.

---

## File structure

### New focused units

- `src/application/extensions/skill-catalog.ts`: immutable resolved package type
  and application port.
- `src/application/extensions/register-project-skills.ts`: project layout,
  logical-ref derivation, and sanitized registration result.
- `src/infrastructure/filesystem/local-skill-catalog.ts`: canonical ref manifest
  lookup and immutable object verification.
- `src/entrypoints/cli/skill-register.ts`: `--project` parsing, Registry-root
  configuration, stable error output, and JSON result printing.
- `scripts/smoke/user-authored-skill-main-flow.mjs`: real pre-start V1
  registration and provider-Agent canary.
- `docs/evidence/user-authored-skill-prestart-registration-evidence.md`: sanitized
  real-run evidence and deferred production work.

### Existing files to generalize

- `src/application/extensions/skill-registry.ts`: generic registration while
  retaining immutable object, limits, modes, and atomic ref publication.
- `src/application/agents/built-in-skills.ts`: constants only; catalog-backed
  resolution replaces body loading.
- `src/application/agents/resolve-agent-version.ts`: inject catalog and return a
  digest-pinned Skill snapshot.
- `src/application/extensions/runtime-extension-binder.ts`: accept resolved
  immutable Skill packages.
- `src/infrastructure/filesystem/opencode-skill-materializer.ts`: remove the
  Memory-only ref/manifest branches.
- `src/infrastructure/extensions/local-runtime-extension-binder.ts`: consume the
  resolved snapshot without reseeding or resolving mutable refs.
- `src/shared/config.ts`: expose one canonical Registry root.
- `src/bootstrap.ts`: seed the built-in Skill once, construct one catalog, and
  share it with resolver/binder.
- `package.json`: expose `skill:register` and the canonical smoke command.

---

### Task 1: Generalize immutable registration and catalog resolution

**Files:**

- Create: `src/application/extensions/skill-catalog.ts`
- Modify: `src/application/extensions/skill-registry.ts`
- Create: `src/infrastructure/filesystem/local-skill-catalog.ts`
- Modify: `src/application/agents/built-in-skills.ts`

- [x] **Step 1: Define the immutable application contract**

Add the following shape to `skill-catalog.ts`:

```ts
export type ResolvedSkillPackage = Readonly<{
  ref: string;
  name: string;
  digest: string;
  objectPath: string;
  manifestPath: string;
  delivery: 'native_project';
  requiredToolRefs: readonly string[];
}>;

export interface SkillCatalogPort {
  resolve(ref: string): Promise<ResolvedSkillPackage | null>;
}
```

Keep mutable project source paths out of this type.

- [x] **Step 2: Replace fixed seeding with generic registration**

In `skill-registry.ts`, export:

```ts
export async function registerSkill(input: {
  registryRoot: string;
  ref: string;
  name: string;
  sourceRoot: string;
  requiredToolRefs: readonly string[];
}): Promise<ResolvedSkillPackage & { changed: boolean }>;
```

Reuse the existing 64-file, 256-KiB-per-file, and 1-MiB-total limits. Preserve
symlink/special-file/executable rejection, deterministic digesting, object mode
`0555`, file/ref-manifest mode `0444`, atomic rename, and idempotency. Validate
frontmatter `name` against `input.name`; project Skills use the leaf directory
name while the existing built-in wrapper may retain its current full name.

Do not add PID locks, stale-lock recovery, or multi-writer serialization. Charge
file limits from the opened file handle before allocation. Attempt direct `0555`
object publication and treat destination-exists rename results as verification
of the existing immutable object. A Darwin permission fallback may transiently
expose an unreferenced `0755` digest path, but it must finalize and verify `0555`
before ref publication; catalog readers must reject it before then. Physical
path visibility alone is not the MVE publication boundary.

Retain `seedMemoryApiSkill()` as a thin compatibility wrapper calling
`registerSkill()` with the built-in source and required Memory Tool.

- [x] **Step 3: Store sufficient ref metadata**

The canonical ref manifest must contain only sanitized immutable metadata:

```ts
{
  ref,
  name,
  digest,
  delivery: 'native_project',
  requiredToolRefs,
  objectRelativePath
}
```

Do not store the original project path or Skill body.

- [x] **Step 4: Implement fail-closed local catalog lookup**

`LocalSkillCatalog.resolve(ref)` must canonicalize
`refs/<logical-ref>.json`, reject traversal, verify the manifest ref and digest,
verify the immutable object realpath is under `objects/`, and return
`ResolvedSkillPackage`. Return `null` only when the ref does not exist; malformed
manifests or objects must throw a sanitized Registry error.

The ref digest, object-directory basename, and content-only object-manifest
digest must be identical. Catalog parsing must reuse the same canonical metadata
validation as registration.

- [x] **Step 5: Keep built-in constants without body injection**

Retain `AGENT_SERVER_MEMORY_API_SKILL_REF`,
`AGENT_SERVER_MEMORY_API_SKILL_VERSION`, and
`AGENT_SERVER_MEMORY_READ_TOOL_REF`. Remove the static file-body resolver once
all call sites use `SkillCatalogPort`; do not reintroduce full Skill bodies into
bootstrap prompts.

- [x] **Step 6: Run the narrowest checks**

Run:

```bash
pnpm exec prettier --check src/application/extensions/skill-catalog.ts \
  src/application/extensions/skill-registry.ts \
  src/infrastructure/filesystem/local-skill-catalog.ts \
  src/application/agents/built-in-skills.ts
```

Expected: formatting passes. The full typecheck follows Task 3 after dependent
call sites have moved to the new type; do not weaken the new type to preserve an
obsolete call site.

---

### Task 2: Add project-directory pre-registration

**Files:**

- Create: `src/application/extensions/register-project-skills.ts`
- Create: `src/entrypoints/cli/skill-register.ts`
- Modify: `src/shared/config.ts`
- Modify: `package.json`

- [x] **Step 1: Add one shared Registry-root config**

Add `AGENT_SERVER_SKILL_REGISTRY_ROOT` to `ConfigSchema`, defaulting to
`.local/skill-registry`, and expose its resolved absolute value in the exported
config object. CLI and Agent Server must use the same resolution rule.

- [x] **Step 2: Parse and validate the local project**

Implement:

```ts
export async function registerProjectSkills(input: {
  projectRoot: string;
  registryRoot: string;
}): Promise<
  readonly {
    ref: string;
    digest: string;
    changed: boolean;
  }[]
>;
```

Read `<project>/agent.yaml` through the existing managed-Agent YAML/package
parser. Enumerate direct directories under `<project>/skills`. Derive refs as
`project/<normalized metadata.name>/<skill-directory-name>`. Require every local
project Skill ref declared by the Agent package to have a matching directory,
and reject unreferenced local Skill directories so typos cannot silently pass.

- [x] **Step 3: Register each directory through the shared service**

Call `registerSkill()` with the leaf directory name and no required Tools for
this Skill-only MVE. Return only ref, digest, and changed. Do not print project or
Registry paths.

- [x] **Step 4: Add the CLI entrypoint**

Parse exactly:

```text
pnpm skill:register -- --project .local/user-skill-probe/project
```

Reject missing, repeated, or unknown arguments. On success, print one JSON
object with `registered`. On failure, print a stable error code and exit nonzero;
do not include Skill contents, raw stack traces, or absolute paths in normal
output.

- [x] **Step 5: Add the package script**

Add:

```json
"skill:register": "node --import tsx src/entrypoints/cli/skill-register.ts"
```

- [x] **Step 6: Perform a disposable direct registration probe**

Create a temporary project only under ignored `.local/`, register V1 twice, and
inspect sanitized output. The first registration must report `changed: true`;
the second must report `changed: false` with the same digest. Remove the
disposable project afterward but retain no Skill body in evidence.

Run:

```bash
pnpm skill:register -- --project .local/user-skill-probe/project
pnpm skill:register -- --project .local/user-skill-probe/project
```

---

### Task 3: Resolve managed Agent Skills through the catalog

**Files:**

- Modify: `src/application/agents/resolve-agent-version.ts`
- Modify: `src/application/agents/resolve-agent-version.test.ts`
- Modify: `src/application/extensions/runtime-extension-binder.ts`
- Modify: `src/application/runs/execute-run.ts`
- Modify: `src/application/runs/execute-run.test.ts`

- [x] **Step 1: Inject `SkillCatalogPort` into `ResolveAgentVersion`**

Extend the constructor with the catalog. For each unique managed
`spec.skills[].ref`, call `catalog.resolve(ref)`. Throw the existing sanitized
unsupported-Skill error when it returns `null`; preserve duplicate rejection.

- [x] **Step 2: Validate required Tools from resolved metadata**

Keep the current supported runtime Tool allowlist for
`agent-server/memory-read`. Replace the exact Memory Skill/Tool pair check with:

```ts
for (const skill of skills) {
  for (const required of skill.requiredToolRefs) {
    if (!toolRefs.includes(required)) {
      throw new Error('A Skill required Tool is not granted.');
    }
  }
}
```

Allow Skill-only sets whose `requiredToolRefs` is empty. Continue rejecting
unknown or duplicate Tool refs.

- [x] **Step 3: Carry the immutable snapshot through application ports**

Replace `ResolvedBuiltInSkill` imports with `ResolvedSkillPackage` in
`ResolvedAgentVersion`, `RuntimeExtensionBinder`, and the create-time execution
input. Preserve `ExecuteRun`'s existing `!priorProviderAgentId` guard so
continuation never resolves or binds Skills again.

- [x] **Step 4: Repair only existing stale fixtures**

Update existing resolver/run fixtures with a fake `SkillCatalogPort` returning
the exact immutable package shape. Do not add a generalized test matrix. Existing
tests must continue proving managed/legacy resolution and create/continue
behavior.

- [x] **Step 5: Verify the affected existing tests**

Run:

```bash
pnpm vitest run src/application/agents/resolve-agent-version.test.ts \
  src/application/runs/execute-run.test.ts
```

Expected: both files pass with no production compatibility default for malformed
managed packages.

---

### Task 4: Generalize OpenCode projection and Runtime binding

**Files:**

- Modify: `src/infrastructure/filesystem/opencode-skill-materializer.ts`
- Modify: `src/infrastructure/extensions/local-runtime-extension-binder.ts`
- Modify: `src/application/context/runtime-prompts.ts` only if needed to preserve
  native-Skill metadata-only prompts

- [x] **Step 1: Remove the Memory-only materializer branches**

Accept any validated `ResolvedSkillPackage`. Derive the ref manifest from the
catalog package, and materialize under the existing actual path:

```text
<project>/.agents/skills/<logical-ref>
```

For `project/research-agent/market-guide`, this is
`.agents/skills/project/research-agent/market-guide`. Preserve realpath
containment, manifest/digest/mode checks, symlink-only delivery, and sanitized
receipt behavior.

The Runtime project is Agent Server-owned and quiescent during create-time
projection. Reject observed unsafe parents and require an existing target's
direct `readlink()` value to equal the immutable object path; adversarial
concurrent replacement of service-owned parent directories is outside this MVE.

Each receipt contains only schema format, ref, digest, and delivery.
Materialization precedes provider creation, so Run/provider correlation remains
in existing durable binding records and E2E evidence rather than being
backfilled into the receipt.

- [x] **Step 2: Stop reseeding inside the binder**

Remove `seedMemoryApiSkill()` and ref lookup from
`LocalRuntimeExtensionBinder.bind()`. The binder must consume the resolved
immutable package snapshot received from `ExecuteRun`, materialize each Skill,
and create the existing MCP Grant only when Tool refs are present.

- [x] **Step 3: Preserve metadata-only bootstrap prompts**

For `delivery: 'native_project'`, `buildBootstrapPrompt()` may announce only
`Native Skill available: <ref>.` It must never render `SKILL.md` content. Custom
Skill marker checks rely on this invariant.

- [x] **Step 4: Run focused type and formatting checks**

Run:

```bash
pnpm check:types
pnpm exec prettier --check \
  src/infrastructure/filesystem/opencode-skill-materializer.ts \
  src/infrastructure/extensions/local-runtime-extension-binder.ts \
  src/application/extensions/runtime-extension-binder.ts
```

Expected: pass.

---

### Task 5: Wire one catalog through bootstrap

**Files:**

- Modify: `src/bootstrap.ts`
- Modify: `src/shared/config.ts` if bootstrap config exposure requires adjustment
- Modify: `scripts/smoke/paseo-opencode-skill.mjs` only to preserve the existing
  built-in direct probe under the generalized Registry

- [x] **Step 1: Construct the shared Registry boundary**

At service creation, resolve the configured Registry root, register the built-in
Memory Skill through the generalized service, and construct one
`LocalSkillCatalog`.

- [x] **Step 2: Inject the same catalog and root**

Pass the catalog to `ResolveAgentVersion` and pass resolved packages to the
Runtime binder. Do not derive a second Registry root from `dirname(agentCwd)`.
CLI and service must converge on `AGENT_SERVER_SKILL_REGISTRY_ROOT`.

- [x] **Step 3: Preserve built-in behavior**

Run the existing direct native Skill probe:

```bash
node scripts/smoke/paseo-opencode-skill.mjs
```

Expected: the built-in marker, symlink, digest, prompt-absence, and cleanup checks
remain true.

- [x] **Step 4: Run affected existing tests and build**

Run:

```bash
pnpm vitest run src/application/agents/resolve-agent-version.test.ts \
  src/application/runs/execute-run.test.ts
pnpm build
```

Expected: pass.

---

### Task 6: Prove one pre-registered user-authored Skill through the real path

**Files:**

- Create: `scripts/smoke/user-authored-skill-main-flow.mjs`
- Modify: `package.json`
- Create: `docs/evidence/user-authored-skill-prestart-registration-evidence.md`
- Create: `docs/runbooks/user-authored-skill-prestart-registration.md`
- Modify:
  `docs/exec-plans/completed/2026-07-28-platform-extension-injection-mve-ext1.md`

- [x] **Step 1: Build a disposable authored Agent project**

The smoke creates its project, Registry, Runtime root, and fresh PostgreSQL
database under ignored/disposable locations. V1 `SKILL.md` contains only the
unique marker `USER_AUTHORED_SKILL_V1_OK`; the marker must be absent from native
system and initial user prompts.

- [x] **Step 2: Register V1 and create one Product Session**

Invoke the real registration application/CLI boundary, import and publish the
managed Agent package, create one Product Session, and run a turn. Assert exact
V1 output,
successful `started → output → succeeded` events, symlink containment under
object A, and one receipt for digest A.

- [x] **Step 3: Prove no-Tool binding and exact durable evidence**

Assert exactly one provider Agent, one custom Skill projection/receipt, zero Tool
Grant/MCP receipts or configs, and one durable assistant Message exactly equal to
`USER_AUTHORED_SKILL_V1_OK`. The marker must be absent from the exact persisted
provider system prompt and from the initial user prompt submitted to the API.
Paseo 0.1.110 does not persist a separate initial-prompt field, so the canary
must not claim one.

- [x] **Step 4: Enforce sanitized output and cleanup**

Output only booleans, counts, event names, digests, and exact-output checks. Stop
Agent Server/Paseo/OpenCode/MCP, remove the disposable authored project,
Registry, and Runtime root, and retain the fresh evidence database only when the
run succeeds. Never print prompts, Skill bodies, bearer values, provider dumps,
or host paths.

- [x] **Step 5: Add the canonical script and run it**

Add:

```json
"smoke:user-skill": "node scripts/smoke/user-authored-skill-main-flow.mjs"
```

Run under Node 24 with the retained PostgreSQL admin connection:

```bash
POSTGRES_ADMIN_URL=postgresql://postgres:postgres@127.0.0.1:55433/postgres \
  pnpm smoke:user-skill
```

Expected summary:

```json
{
  "success": true,
  "v1_exact": true,
  "skill_receipt": true,
  "zero_tool_grants": true,
  "runtime_state_removed": true
}
```

- [x] **Step 6: Record truthful evidence, user enablement, and deferrals**

Document the command, sanitized output, retained evidence database name, and
known limitations. Preserve the existing production blocker: Paseo 0.1.110
persists MCP Authorization headers when MCP Tools are configured. The custom
Skill-only path does not grant a Tool, but this does not resolve the existing
production issue. Document that V1→V2 coexistence requires isolated per-provider
project directories and is explicitly deferred after the main flow.

---

### Task 7: Final verification and plan reconciliation

**Files:**

- Modify only documentation if verification reveals stale counts or statements.

- [x] **Step 1: Run the existing full suite**

```bash
pnpm test
```

Expected: unit, contract, and integration suites pass; report existing skips
exactly.

- [x] **Step 2: Run repository checks**

```bash
pnpm check
pnpm build
git diff --check
```

Expected: all pass under Node 24.

- [x] **Step 3: Inspect worktree scope**

```bash
git status --short --branch
git diff --stat
```

Confirm no credentials, disposable Runtime roots, generated Skill objects,
provider dumps, or unrelated files are tracked.

- [x] **Step 4: Reconcile the Active Exec Plan**

Check every completed item, transfer any non-blocking production work to the
deferred ledger, and keep the plan active unless all repository completion rules
are met. Do not commit or change branch-delivery state without new authorization.
