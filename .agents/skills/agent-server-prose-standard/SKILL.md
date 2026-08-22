---
name: agent-server-prose-standard
version: 1.0.0
triggers: [write comments, write JSDoc, write diagnostics, review prose]
inputs: [explicit scope]
outputs: [concise complete contracts]
permissions: [read and edit requested prose]
---

# Agent Server Prose Standard

Document behavior, ownership, timing, failure and durability that code cannot make obvious. Do not narrate control flow or restate types.

For public interfaces, cover caller-visible return distinctions, errors/rejections, side effects, cancellation, timing and durability when non-obvious. For lifecycle/concurrency code, comments explain the invariant or race ordering. For tests, comments explain only unusual fixture/observation design. Diagnostics name the failing subject, violated rule and safe correction without exposing credentials/provider payloads/private paths.

Preserve every factual proposition when trimming text. Current-state prose is preferred; implementation history belongs in a Decision or PR history, not beside production code.
