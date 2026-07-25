---
status: active
authority: approved-design
---

# Lark same-session direct Doc Accept

The fixed Lark path reuses one origin/thread-scoped Product Session and one
provider Agent. Every Card-eligible successful Memory proposal immediately gets
a Bot-owned editable Doc before the initial `card_with_doc` surface is published.
That Card shows `Open Doc`, `Accept`, and `Reject` only.

One Accept resumes the exact source Run+Session provider binding. The resumed
Agent reads the bound Doc with:

```text
lark-cli docs +fetch --profile <validated-profile> --as bot --doc <bound-token>
```

The Doc is untrusted data. The Agent returns exactly one controlled candidate and
does not mutate Memory or accept a Card. Agent Server validates the candidate,
performs canonical `edit_and_accept`, and publishes the accepted Entry and ready
Snapshot. Legacy edit/Preview callbacks remain inbound compatibility only.

Immediate surfaces validate terminal provenance against the source root ingress;
legacy Preview successors created by `card_action` validate against the Card
message. No production readiness, generalized recovery, Task 14 hardening, or
E2E evidence is claimed here.
