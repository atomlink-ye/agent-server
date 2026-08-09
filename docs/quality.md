# Quality

Quality evidence follows the cheapest honest observation and escalates toward real boundaries. During Prove, the table below is a catalog of available checks, not a requirement to run every lane. A model response alone is not proof of control-plane correctness; a mock alone is not proof that the Paseo seam still works.

| Lane                  | Boundary                                                 |      Deterministic | Prove-stage use           |
| --------------------- | -------------------------------------------------------- | -----------------: | ------------------------- |
| Unit                  | Domain, config, model selection, status mapping, logging |                Yes | Optional focused support  |
| Contract              | HTTP schemas, status codes, safe errors, size limits     |                Yes | Optional unless required by a changed public-contract Human Gate |
| Component integration | Real Paseo adapter with fake SDK port                    |                Yes | Optional focused support  |
| E2E                   | Real HTTP socket with fake runtime                       |                Yes | Optional supporting path  |
| External smoke        | Real daemon, SDK, OpenCode, free model, process cleanup  |                 No | Real boundary when scoped |
| Future Eval           | Task quality, evidence, Team value                       | Controlled dataset | Protect/Harden only       |

Details are in [Testing and evaluations](quality/testing-and-evaluations.md). Merge and release conditions are in [Release gates](quality/release-gates.md).
