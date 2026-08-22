---
name: agent-server-trim-reasoning-history
version: 1.0.0
triggers: [trim stale prose, remove phase narration, documentation cleanup]
inputs: [explicit scope]
outputs: [HEAD-resolvable current-state prose]
permissions: [read and edit requested scope]
---

# Trim Repository Reasoning History

A reader at HEAD must be able to resolve every current-state reference without the original chat, PR or private plan.

Remove or rewrite:

- temporary phase/lane labels that are not product concepts;
- “this PR/previous commit/later step” narration;
- reviewer-addressed correctness arguments;
- stale “used to/no longer/current cut” stories in current docs;
- private decision numbers or uncommitted plan references;
- comments that narrate obvious branch-by-branch control flow.

Preserve real contracts and non-obvious rationale. Move durable architecture rationale to the owning Decision and link it; delete disposable development history. Never silently rewrite model-visible/persisted protocol text without its owning behavior evidence.
