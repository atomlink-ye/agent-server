# Browser runtime capability projection

The browser-safe `GET /api/runtime-capabilities` route exposes the current
deployment's Work-admission capability snapshot. The snapshot is scoped to the
Product Work surface: when that surface is absent, this route is guarded with
the same browser-safe `503 feature_unavailable` response as the other Work
routes. The Agent Server derives the snapshot from the same configured runtime
capability composition used by Work execution; it does not probe the runtime or
infer availability from a 404.

The response is deliberately closed to the three capabilities that affect
browser-visible Work admission:

```json
{
  "supported_runtime_capabilities": [
    "external_workspace",
    "reusable_session",
    "platform_mcp"
  ]
}
```

Values are returned in deterministic order and unsupported values are omitted.
The contract rejects any capability outside this vocabulary, so internal
execution-plane capabilities cannot leak into the browser surface.

Work detail compares this snapshot with the pinned Work Definition's required
runtime capabilities. A known mismatch disables Run start and explains the
missing friendly capability before a click. While the read-only projection is
loading, the control says it is checking. A transient projection read failure
shows bounded error prose and offers `Retry availability check`, which reruns
only the projection reads. A permanently unavailable Work surface remains
unavailable and offers no Retry.
