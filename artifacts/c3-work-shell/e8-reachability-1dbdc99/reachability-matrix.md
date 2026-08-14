# C3/E8 production CLI reachability matrix

Source/test commit: `1dbdc999981e4ab4bbeb875bb2a49062918bd676`, parent
`96cbb8bd94020b072f02b0f752859ce010eef7f8`.

All rows below were executed as real subprocesses on C box
`8174cc0c35a44a568688d8492fe15745` against the static production CLI
`node /root/workspace/.c3-e8-reachability-1dbdc99/c3-e8-classifier.mjs ...`.
Exact stdout/stderr bytes, exit, argv and child-start/raw-status facts are in
the pulled arm directories.

| arm | CLI argv shape | stdout exact marker | stderr | CLI exit | child started | raw child status |
| --- | --- | --- | --- | ---: | --- | --- |
| zero-args | `node c3-e8-classifier.mjs` | `c3_e8_classifier_invalid:reason=usage:expected=<kind> -- <nonempty-command> [args...]\n` | empty | 2 | N/A | N/A |
| unknown-kind | `node c3-e8-classifier.mjs unknown-c3-kind -- node -e <sentinel-write>` | `c3_e8_classifier_invalid:reason=unknown-kind:kind=unknown-c3-kind\n` | empty | 2 | no; sentinel remained absent | N/A; rejected before spawn |
| ENOENT command | `node c3-e8-classifier.mjs test-file-absent -- /definitely/not/a/c3-reachability-command` | `c3_e8_classifier_missing:reason=command-not-available:command=/definitely/not/a/c3-reachability-command\n` | empty | 2 | no | N/A; spawn ENOENT |

The complete Node test harness also passed 12/12 on C box. It uses static
imports of Node builtins and candidate-owned local modules only; there is no
dynamic import, optional parser/API, or fabricated fixture/module missing arm.
A candidate-required local-module linking failure would be raw process 1 with
no marker and FAIL classification, never MISSING.

Remote isolation script hashes were captured separately in the same run; all
four production dual files existed and matched the local blobs.
