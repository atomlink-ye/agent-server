# Glossary

| Term                | Meaning                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------- |
| Invokable           | An immutable Agent or Team version that can receive a Task                               |
| Task                | Canonical formal invocation and genealogy node                                           |
| Run                 | One execution attempt for a Task                                                         |
| Activation          | One worker ownership period within a Run, protected by a fence                           |
| Product Session     | Optional user-facing conversation and root-turn lane                                     |
| Runtime Session     | Replaceable provider context for a leaf Agent Run                                        |
| Workspace           | Long-lived product project containing sources, context, members, artifacts, and memory   |
| Execution Cell      | Isolated runtime placement with scoped filesystem, identity, network, and provider state |
| Artifact            | Immutable versioned deliverable with files and lineage                                   |
| Evidence            | Structured support for a claim, tied to source capture and data-as-of                    |
| Credential Profile  | Non-secret reference to a broker-controlled credential and allowed use                   |
| Completion Contract | Required structured output, artifact, evidence, source, and warning policy               |
| Fence               | Monotonic token that makes stale worker writes fail closed                               |
