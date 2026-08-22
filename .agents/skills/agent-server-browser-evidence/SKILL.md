---
name: agent-server-browser-evidence
version: 1.0.0
triggers: [product-visible Web change, browser acceptance evidence]
inputs: [exact branch commit, user-visible flow]
outputs: [built-app browser evidence provenance]
permissions: [build and run local Web/API, browser automation]
---

# Agent Server Browser Evidence

Use browser evidence for product-visible behavior, not as a substitute for deterministic unit/integration checks.

Build and serve the exact branch commit being demonstrated. Use the real Agent Server BFF/API path; fixture-only pages do not prove the shipping composition. Keep one isolated state root for one demonstrated story. Wait on semantic UI state, not arbitrary sleep. Do not capture secrets, private provider payloads or unrelated user data.

Record provenance with commit SHA, server/profile, whether the runtime/model was real or scripted, and the exact user journey. A UI change is not considered product-path verified merely because a component test rendered.
