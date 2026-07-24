# Document Lifecycle Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate current task context from chronological history, archive superseded task handoffs, reconcile stale Agent Server Spec/Plan artifacts, and mechanically prevent completed work from remaining in `docs/exec-plans/active`.

**Architecture:** The local task bundle becomes a small current-state index plus a newest-first changelog and a history directory. Repository-native Specs and Plans remain separate documents but move as one lifecycle unit. The Exec Plan checker gains file-pair and link-integrity rules with isolated Node tests.

**Tech Stack:** Markdown, Node.js 24 ESM, `node:test`, Agent Server's existing documentation checker and Make targets.

**Design authority:** `docs/superpowers/specs/2026-07-24-document-lifecycle-restructure-design.md`

**Commit policy:** Do not commit, push, or amend unless the user explicitly requests it.

---

## File map

### Task bundle

- Rewrite: `/Volumes/AgentsWorkspace/orgs/0xdtech/tasks/active/agent-server-implementation-20260722/CONTEXT.md` — current state and durable facts only.
- Create: `/Volumes/AgentsWorkspace/orgs/0xdtech/tasks/active/agent-server-implementation-20260722/CHANGELOG.md` — newest-first phase and validation history.
- Create: `/Volumes/AgentsWorkspace/orgs/0xdtech/tasks/active/agent-server-implementation-20260722/history/README.md` — complete historical-artifact index.
- Move: the task-local Durable Kernel plan and every superseded `HANDOFF-*.md` into `history/`.
- Keep: `HANDOFF-2026-07-24-managed-single-agent-v1-pr-merged.md`, `WORKFLOW-2026-07-24-agent-server-delivery.md`, and `.learnings/` at the task root.

### Repository

- Create then archive: `docs/exec-plans/active/2026-07-24-document-lifecycle-restructure.md`.
- Move five stale files from `docs/exec-plans/active/` to `docs/exec-plans/completed/`.
- Modify three canonical completed plans to point at completed Spec/Plan paths.
- Modify: `docs/agents/exec-plan-protocol.md` — define the paired archival invariant.
- Modify: `scripts/ci/check-exec-plans.mjs` — export check logic and enforce lifecycle/link rules.
- Create: `scripts/ci/check-exec-plans.test.mjs` — isolated positive and negative checker cases.
- Modify: `package.json` — run the checker test before the live repository check.
- Keep: product/runtime source, migrations, APIs, and test semantics unchanged.

---

### Task 1: Establish the active documentation-lifecycle Exec Plan

**Files:**

- Create: `docs/exec-plans/active/2026-07-24-document-lifecycle-restructure.md`

- [ ] **Step 1: Create the active Plan before substantive edits**

Use this exact frontmatter and checklist structure:

```markdown
---
status: active
owner: orchestrator
created_at: 2026-07-24
updated_at: 2026-07-24
authority: execution-plan
---

# Document Lifecycle Restructure

## Outcome

Separate current task context from historical logs and make related Spec/Plan
artifacts leave the active lane together when work is complete.

## Context and authority

- Design: `docs/superpowers/specs/2026-07-24-document-lifecycle-restructure-design.md`
- Implementation plan: `docs/superpowers/plans/2026-07-24-document-lifecycle-restructure.md`

## Scope

- [ ] Restructure the external task bundle.
- [ ] Reconcile and archive stale Specs/Plans.
- [ ] Document and mechanically enforce the lifecycle invariant.

## Non-goals

- Product, API, migration, runtime, or model behavior changes.
- Deleting historical handoffs or learning logs.

## Work breakdown

- [ ] Add task-bundle `CHANGELOG.md` and `history/` index.
- [ ] Rewrite current `CONTEXT.md` and update moved-file references.
- [ ] Archive the five stale active Spec/Plan artifacts.
- [ ] Add checker tests and lifecycle rules.

## Verification

- [ ] Checker negative cases fail for split lanes and completed-to-active links.
- [ ] `pnpm check:exec-plans` passes.
- [ ] `make check` passes.
- [ ] Task-bundle references resolve and Git status contains only intended files.

## Documentation impact

- [ ] Exec Plan protocol updated.
- [ ] Task bundle current context and history updated.

## Decisions and discoveries

- Specs and Plans remain separate but form one archival unit.
- Historical handoffs move to `history/`; the current handoff remains at root.

## Risks and recovery

- Restore moved files and links together if reference verification fails.

## Validation evidence

Pending execution.

## Completion checklist

- [ ] Every scope item is complete or explicitly transferred.
- [ ] No unchecked item remains before archival.
- [ ] Plan moved to `completed/` with `status: completed`.

## Current blocker

None.

## Next exact command

`node --test scripts/ci/check-exec-plans.test.mjs`

## Cleanup state

No temporary process or database work is required.
```

- [ ] **Step 2: Verify the active Plan is accepted by the current checker**

Run:

```bash
pnpm check:exec-plans
```

Expected: PASS before any stale documents are moved.

---

### Task 2: Restructure the external task bundle

**Files:**

- Create: `/Volumes/AgentsWorkspace/orgs/0xdtech/tasks/active/agent-server-implementation-20260722/CHANGELOG.md`
- Create: `/Volumes/AgentsWorkspace/orgs/0xdtech/tasks/active/agent-server-implementation-20260722/history/README.md`
- Rewrite: `/Volumes/AgentsWorkspace/orgs/0xdtech/tasks/active/agent-server-implementation-20260722/CONTEXT.md`
- Move into `history/`:
  - `2026-07-22-durable-kernel-a-plan.md`
  - `HANDOFF-2026-07-22-durable-kernel-a.md`
  - `HANDOFF-2026-07-22-durable-kernel-a-final.md`
  - `HANDOFF-2026-07-22-phase-2a-pr-pending.md`
  - `HANDOFF-2026-07-23-sequential-team-mvp-pr-open.md`
  - `HANDOFF-2026-07-23-sequential-team-mvp-pr-merged.md`
  - `HANDOFF-2026-07-23-workspace-memory-proposal-planning-paused.md`
  - `HANDOFF-2026-07-23-workspace-memory-proposal-pr-open.md`
  - `HANDOFF-2026-07-23-managed-single-agent-v1-phase-a-paused.md`
  - `HANDOFF-2026-07-24-managed-single-agent-v1-pr-open.md`
- Modify references in the moved files, current handoff, workflow, `.learnings/LEARNINGS.md`, and repository completed plans where exact old paths occur.

- [ ] **Step 1: Record the pre-move reference set**

Run from the workspace root:

```bash
rg -n "agent-server-implementation-20260722/(2026-07-22-durable-kernel-a-plan|HANDOFF-2026-07-2[23])" \
  /Volumes/AgentsWorkspace/orgs/0xdtech/tasks/active/agent-server-implementation-20260722 \
  /Volumes/AgentsWorkspace/orgs/0xdtech/code/agent-server/.worktrees/managed-single-agent-v1
```

Expected: references in `CONTEXT.md`, historical handoffs, workflow/learnings, and at least one completed repository plan. Preserve this output for comparison.

- [ ] **Step 2: Create `history/` and move the exact historical files**

Use file-aware moves so contents remain unchanged. Keep these root files in place:

```text
CONTEXT.md
WORKFLOW-2026-07-24-agent-server-delivery.md
HANDOFF-2026-07-24-managed-single-agent-v1-pr-merged.md
.learnings/
```

Expected: no duplicate source copies remain at the task root.

- [ ] **Step 3: Write `history/README.md`**

Use a table with columns `Date`, `Artifact`, `Checkpoint`, and `Superseded by`.
Include every moved file exactly once. The final row must link the latest
historical checkpoint to `../HANDOFF-2026-07-24-managed-single-agent-v1-pr-open.md`.

- [ ] **Step 4: Write newest-first `CHANGELOG.md`**

Use these exact top-level entries:

```markdown
# Agent Server Task Changelog

## 2026-07-24 — Real Managed Memory canary

## 2026-07-24 — Managed Single-Agent V1 PR #6

## 2026-07-23 — Managed Single-Agent V1 implementation

## 2026-07-23 — Workspace Memory Proposal MVP

## 2026-07-23 — Sequential Team MVP

## 2026-07-22 — Authenticated Admission Foundation

## 2026-07-22 — Durable Kernel A

## 2026-07-22 — Harness baseline
```

The Memory entry must record both failed diagnostic attempts and the final
truth: a real PostgreSQL 16 run succeeded after using one aligned Workspace ID
for service-account, AgentVersion, Product Session, Task, and proposal scope.
Link each phase to its complete historical handoff and repository completed
Exec Plan where available.

- [ ] **Step 5: Rewrite `CONTEXT.md` as the current entrypoint**

Use only these sections:

```markdown
# Agent Server implementation context

## Purpose

## Current authoritative resume pointer

## Current state

## Stable repository facts

## Authority and reading order

## Runtime and verification constraints

## Task bundle index

## Next action
```

Do not copy historical branch status, old next steps, phase narratives, or
specialist reconciliation logs. Link those to `CHANGELOG.md` and `history/`.

- [ ] **Step 6: Rewrite every moved absolute path**

Replace each old root-level historical path with the corresponding
`.../history/<filename>` path. Update relative Markdown links after the move.
Do not change current-handoff or workflow paths.

- [ ] **Step 7: Verify task-bundle reachability and stale-reference absence**

Run:

```bash
rg -n "agent-server-implementation-20260722/(2026-07-22-durable-kernel-a-plan|HANDOFF-2026-07-2[23])" \
  /Volumes/AgentsWorkspace/orgs/0xdtech/tasks/active/agent-server-implementation-20260722 \
  /Volumes/AgentsWorkspace/orgs/0xdtech/code/agent-server/.worktrees/managed-single-agent-v1
```

Expected: every match for a moved artifact includes `/history/`; current handoff
and workflow references remain root-level.

---

### Task 3: Reconcile and archive stale Specs and Plans

**Files:**

- Move to `docs/exec-plans/completed/`:
  - `2026-07-22-phase-2a-authenticated-admission-foundation-spec.md`
  - `2026-07-22-phase-2a-authenticated-admission-foundation-plan.md`
  - `2026-07-22-sequential-team-mvp-spec.md`
  - `2026-07-22-sequential-team-mvp-plan.md`
  - `2026-07-23-workspace-memory-proposal-mvp-spec.md`
- Modify:
  - `docs/exec-plans/completed/2026-07-22-phase-2a-authenticated-admission-foundation.md`
  - `docs/exec-plans/completed/2026-07-22-sequential-team-mvp.md`
  - `docs/exec-plans/completed/2026-07-23-workspace-memory-proposal-mvp.md`

- [ ] **Step 1: Reconcile Phase 2A's seven stale unchecked items**

Change the seven Task 3/4 checkboxes in
`2026-07-22-phase-2a-authenticated-admission-foundation-plan.md` to checked only
after adding this note immediately before Task 3:

```markdown
> Historical reconciliation (2026-07-24): Tasks 3 and 4 were completed in the
> implementation recorded by the canonical completed Exec Plan. The checkboxes
> below are reconciled against its contract, E2E, documentation, and full-gate
> validation evidence; they do not represent work rerun on this date.
```

Set its status to `completed` and update `updated_at` to `2026-07-24`.

- [ ] **Step 2: Mark the other four artifacts completed**

For each Spec/Plan, set `status: completed` and update an existing `updated_at`
field to `2026-07-24`. Confirm none contains `- [ ]`.

- [ ] **Step 3: Move all five files together**

Move each file to `docs/exec-plans/completed/` with the same filename. Expected:
the only active repository Plan is this restructure task's new active Plan.

- [ ] **Step 4: Repair canonical completed-plan references**

Update Phase 2A and Sequential Team links from `active/` to the exact new
`completed/` Spec and Plan paths.

For Workspace Memory, replace the nonexistent implementation-plan link with:

```markdown
- No separate implementation-plan artifact was retained; this canonical
  completed Exec Plan is the execution record.
```

Point its accepted design Spec to the new completed path.

- [ ] **Step 5: Verify no completed plan links to active**

Run:

```bash
rg -n "docs/exec-plans/active/" docs/exec-plans/completed
```

Expected: no matches.

---

### Task 4: Add failing lifecycle-checker tests

**Files:**

- Create: `scripts/ci/check-exec-plans.test.mjs`
- Modify later: `scripts/ci/check-exec-plans.mjs`

- [ ] **Step 1: Write the Node test fixture helper and six cases**

Start the test file with this complete fixture setup:

```javascript
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { collectExecPlanErrors } from './check-exec-plans.mjs';

let root;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'agent-server-exec-plans-'));
  await Promise.all([
    mkdir(join(root, 'active')),
    mkdir(join(root, 'completed')),
  ]);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function plan(lane, name, status, body = '') {
  await writeFile(
    join(root, lane, name),
    `---\nstatus: ${status}\n---\n\n${body}\n`,
    'utf8',
  );
}
```

Required cases:

```javascript
test('accepts an active standalone spec', async () => {
  await plan('active', '2026-07-24-new-feature-spec.md', 'active');
  assert.deepEqual(await collectExecPlanErrors(root), []);
});

test('rejects a completed document linking to active', async () => {
  await plan(
    'completed',
    '2026-07-24-feature.md',
    'completed',
    'See `docs/exec-plans/active/2026-07-24-feature-spec.md`.',
  );
  assert.match(
    (await collectExecPlanErrors(root)).join('\n'),
    /links to active/,
  );
});

test('rejects split spec and plan lanes', async () => {
  await plan('completed', '2026-07-24-feature-spec.md', 'completed');
  await plan('active', '2026-07-24-feature-plan.md', 'active');
  assert.match(
    (await collectExecPlanErrors(root)).join('\n'),
    /split across lanes/,
  );
});

test('rejects active detail beside canonical completed task', async () => {
  await plan('completed', '2026-07-24-feature.md', 'completed');
  await plan('active', '2026-07-24-feature-spec.md', 'active');
  assert.match(
    (await collectExecPlanErrors(root)).join('\n'),
    /canonical completed/,
  );
});

test('retains status and unchecked-item validation', async () => {
  await plan(
    'completed',
    '2026-07-24-feature.md',
    'active',
    '- [ ] unfinished',
  );
  const errors = (await collectExecPlanErrors(root)).join('\n');
  assert.match(errors, /status must be completed/);
  assert.match(errors, /cannot contain unchecked/);
});

test('accepts a completed spec-plan pair and canonical record', async () => {
  await plan('completed', '2026-07-24-feature.md', 'completed');
  await plan('completed', '2026-07-24-feature-spec.md', 'completed');
  await plan('completed', '2026-07-24-feature-plan.md', 'completed');
  assert.deepEqual(await collectExecPlanErrors(root), []);
});
```

The fixture setup must remain exactly isolated: every test receives new active
and completed directories, and cleanup removes the entire temporary root.

- [ ] **Step 2: Run the new tests and verify RED**

Run:

```bash
node --test scripts/ci/check-exec-plans.test.mjs
```

Expected: FAIL because `collectExecPlanErrors` is not exported and the new rules
do not exist.

---

### Task 5: Implement the lifecycle checker and protocol

**Files:**

- Modify: `scripts/ci/check-exec-plans.mjs`
- Modify: `package.json`
- Modify: `docs/agents/exec-plan-protocol.md`

- [ ] **Step 1: Refactor the checker into an exported function**

Implement:

```javascript
export async function collectExecPlanErrors(root) {
  const errors = [];
  const records = [];
  for (const lane of ['active', 'completed']) {
    const directory = join(root, lane);
    if (!(await exists(directory))) {
      errors.push(
        `missing Exec Plan lane: ${relative(repositoryRoot, directory)}`,
      );
      continue;
    }
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const path = join(directory, entry.name);
      const source = await readFile(path, 'utf8');
      const display = relative(repositoryRoot, path);
      const status = source.match(/^status:\s*(active|completed)\s*$/m)?.[1];
      if (status !== lane)
        errors.push(
          `${display}: status must be ${lane}, found ${status ?? 'none'}`,
        );
      if (lane === 'completed' && /^\s*- \[ \]/m.test(source))
        errors.push(
          `${display}: completed plans cannot contain unchecked items`,
        );
      if (lane === 'completed' && /docs\/exec-plans\/active\//.test(source))
        errors.push(
          `${display}: completed plans cannot contain links to active`,
        );
      records.push({ lane, name: entry.name, display });
    }
  }
  enforceArtifactLanes(records, errors);
  return errors;
}
```

Implement the helper with this complete behavior:

```javascript
function enforceArtifactLanes(records, errors) {
  const completedNames = new Set(
    records
      .filter((record) => record.lane === 'completed')
      .map((record) => record.name),
  );
  const detailsBySlug = new Map();

  for (const record of records) {
    const match = record.name.match(/^(.+)-(spec|plan)\.md$/);
    if (!match) continue;
    const [, slug, kind] = match;
    const details = detailsBySlug.get(slug) ?? {};
    details[kind] = record;
    detailsBySlug.set(slug, details);
  }

  for (const [slug, details] of detailsBySlug) {
    if (
      details.spec &&
      details.plan &&
      details.spec.lane !== details.plan.lane
    ) {
      errors.push(
        `${slug}: related Spec and Plan are split across lanes (${details.spec.lane}/${details.plan.lane})`,
      );
    }
    if (
      completedNames.has(`${slug}.md`) &&
      [details.spec, details.plan].some((record) => record?.lane === 'active')
    ) {
      errors.push(
        `${slug}: detail artifact remains active beside canonical completed plan`,
      );
    }
  }
}
```

Import `pathToFileURL` from `node:url`. Retain the existing CLI output by calling
the exported function only when:

```javascript
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const errors = await collectExecPlanErrors(planRoot);
  if (errors.length > 0) {
    process.stderr.write(
      `Exec Plan checks failed:\n- ${errors.join('\n- ')}\n`,
    );
    process.exitCode = 1;
  } else {
    const count = await countMarkdownPlans(planRoot);
    process.stdout.write(`Exec Plan checks passed (${count} plans).\n`);
  }
}
```

Add this helper to preserve the current success output contract:

```javascript
async function countMarkdownPlans(root) {
  let count = 0;
  for (const lane of ['active', 'completed']) {
    const directory = join(root, lane);
    if (!(await exists(directory))) continue;
    const entries = await readdir(directory, { withFileTypes: true });
    count += entries.filter(
      (entry) => entry.isFile() && entry.name.endsWith('.md'),
    ).length;
  }
  return count;
}
```

- [ ] **Step 2: Run the lifecycle tests and verify GREEN**

Run:

```bash
node --test scripts/ci/check-exec-plans.test.mjs
```

Expected: six tests pass.

- [ ] **Step 3: Wire checker tests into the package command**

Change only this script:

```json
"check:exec-plans": "node --test scripts/ci/check-exec-plans.test.mjs && node scripts/ci/check-exec-plans.mjs"
```

- [ ] **Step 4: Document paired archival**

Append to `docs/agents/exec-plan-protocol.md` under `## Archival`:

```markdown
### Related Spec and Plan artifacts

When both `<slug>-spec.md` and `<slug>-plan.md` exist, they form one archival
unit while remaining separate documents. Completion moves both to `completed/`,
sets completed status, resolves or explicitly transfers every unchecked item,
and rewrites links away from `active/`. A standalone active Spec is allowed
during design. A missing counterpart is allowed only when the canonical Plan
states that no separate artifact was retained.
```

- [ ] **Step 5: Run the focused repository checker**

Run:

```bash
pnpm check:exec-plans
```

Expected: test cases pass and the live repository check passes.

---

### Task 6: Close evidence and archive this change's own Plan

**Files:**

- Update then move: `docs/exec-plans/active/2026-07-24-document-lifecycle-restructure.md`
- Update: task-bundle `CHANGELOG.md`
- Update: task-bundle `CONTEXT.md` if current references changed during execution.

- [ ] **Step 1: Run the narrow documentation checks**

Run:

```bash
pnpm check:docs
pnpm check:exec-plans
```

Expected: PASS.

- [ ] **Step 2: Run the repository's meaningful full documentation gate**

Run:

```bash
make check
```

Expected: type, format, docs, and Exec Plan checks pass. Product tests are not
required because no product/runtime behavior changed.

- [ ] **Step 3: Verify file and reference invariants directly**

Run:

```bash
rg -n "docs/exec-plans/active/" docs/exec-plans/completed
rg -n "agent-server-implementation-20260722/(2026-07-22-durable-kernel-a-plan|HANDOFF-2026-07-2[23])" \
  /Volumes/AgentsWorkspace/orgs/0xdtech/tasks/active/agent-server-implementation-20260722 \
  /Volumes/AgentsWorkspace/orgs/0xdtech/code/agent-server/.worktrees/managed-single-agent-v1
git status --short
```

Expected:

- first search has no matches;
- second search uses `/history/` for every moved artifact;
- Git status contains only the intended design/plan/checker/protocol/archive and
  reference updates;
- `docs/exec-plans/active/` contains only this change's Plan before the next step.

- [ ] **Step 4: Complete and archive this Plan**

Record the exact successful commands and results in `Validation evidence`, check
every remaining item, set `status: completed`, update `updated_at`, replace the
blocker/next-command fields with truthful terminal state, then move it to:

```text
docs/exec-plans/completed/2026-07-24-document-lifecycle-restructure.md
```

- [ ] **Step 5: Re-run the checker after self-archival**

Run:

```bash
pnpm check:exec-plans
```

Expected: PASS with no files remaining in `docs/exec-plans/active/` unless a
separate genuinely active task was created during execution.

- [ ] **Step 6: Record the restructure in the task changelog**

Add a newest-first entry linking the completed repository Plan and noting:

- `CONTEXT.md` is current-only;
- historical handoffs live under `history/`;
- related Spec/Plan artifacts now archive together;
- the lifecycle checker enforces split-lane and completed-to-active-link rules.

Do not commit or push without explicit user instruction.
