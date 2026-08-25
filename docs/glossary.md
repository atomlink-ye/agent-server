# Glossary

| Term                | Meaning                                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| AgentDefinition     | Long-lived Coworker identity used by the Conversation and Chat planes                                                              |
| AgentVersion        | Immutable Coworker/Chat behavior snapshot; not formal Worker authority                                                             |
| WorkerDefinition    | Reusable formal execution role identity                                                                                            |
| WorkerVersion       | Immutable published execution-role snapshot selected by Work or Team composition                                                   |
| Invokable           | Legacy Task-boundary term; compatibility ingress may accept Agent/Team versions, while formal Work targets Worker/Team composition |
| Task                | Canonical formal invocation and genealogy node                                                                                     |
| Run                 | One execution attempt for a Task                                                                                                   |
| Attempt             | One bounded execution/ownership period; retry creates a new attempt without upgrading the pinned version                           |
| Activation          | One worker ownership period within a Run, protected by a fence                                                                     |
| Product Session     | Optional user-facing conversation and root-turn lane                                                                               |
| Runtime Session     | Replaceable provider context for Chat or formal Worker execution; never product identity                                           |
| Workspace           | Long-lived product project containing sources, context, members, artifacts, and memory                                             |
| Execution Cell      | Isolated runtime placement with scoped filesystem, identity, network, and provider state                                           |
| Artifact            | Immutable versioned deliverable with files and lineage                                                                             |
| Evidence            | Structured support for a claim, tied to source capture and data-as-of                                                              |
| Credential Profile  | Non-secret reference to a broker-controlled credential and allowed use                                                             |
| Completion Contract | Required structured output, artifact, evidence, source, and warning policy                                                         |
| Fence               | Monotonic token that makes stale worker writes fail closed                                                                         |
