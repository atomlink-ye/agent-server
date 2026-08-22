---
name: agent-server-runtime-recovery-review
version: 1.0.0
triggers: [RuntimeSession change, ExecutionPlane change, MCP change, grant change, worker lifecycle change]
inputs: [explicit runtime scope]
outputs: [restart/recovery contract review]
permissions: [read repository, run relevant runtime checks]
---

# Agent Server Runtime Recovery Review

Every runtime change must name four things separately:

1. **stable Agent Server identity** — RuntimeSession / Work / Task scope;
2. **durable external binding** — provider session/workspace generation;
3. **desired configuration** — provider/model/bootstrap/extensions/context revision;
4. **process-local state** — handles, active calls, caches, listeners.

For each attach/resume path answer:

- what survives Agent Server process restart;
- how the current desired spec is compared with the provider's applied generation;
- whether the provider can reconfigure in place;
- who creates/replaces a generation when it cannot;
- what atomically becomes current;
- how old grants/generations are revoked/superseded;
- what the caller may assume after success;
- which explicit error is returned when recovery cannot establish that postcondition.

A successful attach may never mean only “provider ID exists.” For tool-capable sessions it must imply that the current Agent Server MCP endpoint and authorization can be used by the provider context. Require a deterministic restart scenario and a real-runtime canary path for changes to this contract.
