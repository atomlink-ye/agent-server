---
name: agent-server-stacked-prs
version: 1.0.0
triggers: [stacked PRs, dependent PRs, refactor stack]
inputs: [live PR chain]
outputs: [verified dependency order and validation state]
permissions: [read PR metadata, update authorized branches/PRs]
---

# Agent Server Stacked PR Workflow

When work is intentionally split into dependent PRs, establish the live bottom-to-top base chain before changing branches. Use the repository's supported GitHub stack workflow when available; do not simulate a stack by casually retargeting unrelated PRs.

After a base advances or any branch is rebased, re-read exact head/base SHAs, recompute changed scope and rerun the evidence invalidated by the rewrite. Each layer must remain independently understandable: the lower layer owns the contract it introduces and upper layers depend on that contract rather than copying it.

Do not merge refactor stacks on behalf of the user unless explicitly requested. Report blockers, current order and the checks actually associated with each layer.
