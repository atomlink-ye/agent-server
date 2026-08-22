# N2 Persistent Chat Delta + Wake Semantics

Implementation branch companion for the Drive roadmap:

https://docs.google.com/document/d/1PTZlFyZWE0Sek0XOQBlg7oRdMfWptPIak8fTHBZWjrE/edit

Stacked on N1 (`refactor/final-agent-identity-harness-convergence`).

Target invariant:

`Conversation / Work event → durable wake → coalesced Chat activation → AgentChatRuntime → RuntimeSession(agent_chat) → resume provider session → bootstrap/delta/recover input → materialize reply / Work action`

This branch implements the complete N2 roadmap. The repository copy is intentionally concise; the Google Drive document is the durable product/engineering roadmap source.
