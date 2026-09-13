# Real Coworker conversation — 1440px

This record was captured on 2026-09-13 from the real host-native product at a
1440×900 viewport. The stack used PostgreSQL 15 and Paseo's authenticated Codex
provider (`gpt-5.6-luna`); it did not use fixture replay or mocked chat replies.

## Recordings

- [Create Coworker and first turn](01-create-and-first-turn.webm)
- [Long reply and queued follow-up](02-long-reply-and-follow-up.webm)

The screenshots preserve the important states without requiring video playback:

- [Coworker ready to create](coworker-ready.png)
- [Long turn accepted and waiting](long-turn-waiting.png)
- [Reader scrolled up during the response](reader-scrolled-up.png)
- [Both provider replies settled](conversation-settled.png)

## Journey and observed timing

The user created a new Coworker named Pulse through **Create & Chat**, exchanged
a short greeting, requested a response of at least 700 words, and submitted a
bilingual follow-up while that response was still running.

The long message was visibly accepted within the first polling interval and the
composer remained usable. The follow-up was accepted 3.5 seconds later. The
transcript then displayed **Waiting for a reply** without partial answer text.
The complete long answer appeared 39.8 seconds after its send was accepted; its
body arrived as one 9,151-character jump. The bilingual follow-up answer appeared
8.9 seconds later.

This means the surface acknowledges work promptly but does not stream provider
output. During a long generation it feels alive rather than frozen, yet after
roughly 15–20 seconds the unchanged generic indicator provides too little
evidence to distinguish productive thinking from a stuck run. There is no
elapsed time, phase, cancellation control, or partial content.

Before the accompanying fix, the first reply also removed **Waiting for a reply**
while the queued follow-up was still executing. The UI therefore appeared
finished for 8.9 seconds. The fix keeps the pending indicator visible until each
queued principal turn has a corresponding Agent reply.

Scroll behavior was correct. After the long answer arrived, the reader moved up
to `scrollTop = 1396`. The follow-up increased `scrollHeight` from 4187 to 4448,
while `scrollTop` remained exactly 1396 instead of pulling the reader to the
bottom.

## Remaining product gap

True streaming cannot be repaired in the transcript component alone. The current
browser contract polls durable, completed messages; it does not expose provider
token or partial-message events. A proper fix needs an explicit server delivery
contract for partial output, stable message identity across revisions, terminal
and failed states, reconnect/resume behavior, and scroll semantics for growth of
the final bubble. Until that exists, labeling this surface “streaming” would be
misleading.
