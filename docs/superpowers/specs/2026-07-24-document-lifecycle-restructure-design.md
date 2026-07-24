# Document Lifecycle Restructure Design

**Date:** 2026-07-24
**Status:** implemented and verified

## Outcome

Separate current reusable context from chronological task history, preserve old
handoffs under a dedicated history directory, and make Agent Server Exec Plan
archival mechanically consistent for related Spec and Plan artifacts.

## Scope

This change covers two documentation systems:

1. The local task bundle at
   `/Volumes/AgentsWorkspace/orgs/0xdtech/tasks/active/agent-server-implementation-20260722`.
2. Agent Server's repository-native `docs/exec-plans` lifecycle and its CI
   checker.

It does not alter product behavior, public APIs, migrations, runtime behavior,
or deterministic/external test semantics.

## Task bundle structure

The task bundle root will contain only current entrypoints and reusable
guidance:

```text
agent-server-implementation-20260722/
├── CONTEXT.md
├── CHANGELOG.md
├── WORKFLOW-2026-07-24-agent-server-delivery.md
├── HANDOFF-2026-07-24-managed-single-agent-v1-pr-merged.md
├── history/
│   ├── README.md
│   ├── 2026-07-22-durable-kernel-a-plan.md
│   └── historical HANDOFF files
└── .learnings/
```

### `CONTEXT.md`

`CONTEXT.md` is the current resume entrypoint. It will contain only:

- the current authoritative handoff;
- current worktree, branch, HEAD, PR, and next action;
- stable repository paths, authority order, and operating constraints;
- supported runtime/tooling facts;
- links to `CHANGELOG.md`, the workflow, the current handoff, and the history
  index.

It will not contain dated implementation narratives, old branch status,
superseded next steps, specialist reconciliation history, or full phase
summaries.

### `CHANGELOG.md`

`CHANGELOG.md` is a newest-first chronological index. Each entry records:

- date and phase;
- material outcome or state transition;
- PR/branch status when relevant;
- meaningful verification evidence or failure classification;
- links to the complete handoff and repository-native completed Exec Plan.

The changelog preserves summarized history but does not replace complete
handoffs. It will include the latest real Paseo/OpenCode Memory canary, including
the aligned-Workspace provenance requirement and successful propose, edit,
snapshot, pin, and recall sequence.

### `history/`

Move every superseded handoff and the task-local Durable Kernel plan into
`history/`. Keep the current PR #6 merged handoff at the task root. Add
`history/README.md` as a dated index that identifies each artifact as a paused,
PR-open, merged, or final checkpoint.

Update all task-bundle and repository references to moved files. Do not leave
duplicate source files or compatibility stubs unless an external reference
cannot be updated.

### `.learnings/`

Leave `.learnings/` in place. It remains a distinct learning/error register and
must not be folded into the changelog.

## Agent Server Exec Plan archival

Treat a feature's Spec and Plan as one lifecycle unit while retaining them as
separate documents.

### Current reconciliation

No current file under `docs/exec-plans/active/` represents genuinely active
work.

- Move the Phase 2A Spec and Plan to `completed/` together.
- Move the Sequential Team MVP Spec and Plan to `completed/` together.
- Move the Workspace Memory Proposal MVP Spec to `completed/` and repair the
  canonical completed plan's dangling reference to a nonexistent separate Plan.

For each moved document:

- set `status: completed`;
- update `updated_at` where the document has that field;
- remove unchecked state only through explicit reconciliation against existing
  completed-plan validation evidence;
- record that reconciliation in the historical Plan rather than silently
  presenting old unchecked items as newly executed;
- rewrite links from `active/` to `completed/`.

The existing canonical completed execution records remain authoritative. The
archived Spec and detailed Plan retain design and task-level history.

## Lifecycle invariant

Update `docs/agents/exec-plan-protocol.md` with this invariant:

> When both a Spec and Plan exist for one task slug, they form one archival
> unit. Completion moves both artifacts to `completed/`, gives both completed
> status, resolves or explicitly transfers every unchecked item, and rewrites
> links away from `active/`.

A missing paired artifact is allowed only when the canonical Plan explicitly
states that no separate counterpart was retained. The process must not invent a
fake historical document solely to satisfy pairing.

## Mechanical checks

Extend `scripts/ci/check-exec-plans.mjs` while retaining its current checks.
The checker will fail when:

1. a completed Exec Plan contains an unchecked item;
2. a file's status does not match its lane;
3. a completed artifact links to `docs/exec-plans/active/`;
4. matching `-spec.md` and `-plan.md` files exist in different lanes;
5. a canonical completed task file exists while a matching Spec or Plan remains
   active.

The pairing rules apply only to files that actually exist. A Spec may exist
alone during design, and a task may intentionally retain only one canonical
execution document when that absence is explicit and links are not dangling.

## Implementation order

1. Create a short active Exec Plan for this cross-document lifecycle change.
2. Restructure the task bundle and update all moved-file references.
3. Reconcile and move stale Agent Server Spec/Plan artifacts.
4. Update the Exec Plan protocol.
5. Add the lifecycle checks.
6. Run focused checker tests or fixtures, then `make check`.
7. Record validation and archive this change's own Spec/Plan artifacts together.

## Verification

Verification must establish:

- `CONTEXT.md` contains no stale phase-current claims;
- every historical task artifact is reachable from `CHANGELOG.md` or
  `history/README.md`;
- no live reference points to a moved task-bundle path;
- no completed repository artifact links to `docs/exec-plans/active/`;
- `docs/exec-plans/active/` contains only genuinely active work;
- checker negative fixtures reject split-lane pairs and completed-to-active
  links;
- `make check` succeeds;
- no product source or runtime behavior changed.

## Risks and recovery

- **Broken absolute links:** inventory and rewrite references before deleting old
  paths; verify with repository/task-bundle searches.
- **False completion:** reconcile unchecked Phase 2A items only against the
  canonical completed evidence and preserve an explanatory note.
- **Over-strict checker:** allow active standalone design Specs and intentional
  single-document plans; enforce pairing only when matching artifacts exist or a
  canonical completed task proves the task is done.
- **History loss:** move rather than delete original handoffs and preserve their
  contents unchanged except for links or explicit superseded labels.

Rollback consists of restoring moved task files to their original locations,
reverting link updates, and reverting the checker/protocol changes as one unit.
