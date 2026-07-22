# Quality

Quality evidence follows the smallest test that can detect a defect and escalates toward real boundaries. A model response alone is not proof of control-plane correctness; a mock alone is not proof that the Paseo seam still works.

| Lane                  | Boundary                                                 |      Deterministic |              PR gate |
| --------------------- | -------------------------------------------------------- | -----------------: | -------------------: |
| Unit                  | Domain, config, model selection, status mapping, logging |                Yes |                  Yes |
| Contract              | HTTP schemas, status codes, safe errors, size limits     |                Yes |                  Yes |
| Component integration | Real Paseo adapter with fake SDK port                    |                Yes |                  Yes |
| E2E                   | Real HTTP socket with fake runtime                       |                Yes |                  Yes |
| External smoke        | Real daemon, SDK, OpenCode, free model, process cleanup  |                 No | No; manual/scheduled |
| Future Eval           | Task quality, evidence, Team value                       | Controlled dataset |    Release-dependent |

Details are in [Testing and evaluations](quality/testing-and-evaluations.md). Merge and release conditions are in [Release gates](quality/release-gates.md).
