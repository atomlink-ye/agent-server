// READ-ONLY probe. Subscribes to the daemon's shared agent_stream and records
// every event verbatim, one JSON object per line, keeping the agentId the
// daemon itself puts on the envelope. It never creates, messages or mutates an
// agent. Attribution to a role is done afterwards, from the labels the daemon
// already stores, so nothing here manufactures the evidence it reports.
import { appendFileSync } from 'node:fs';
import { DaemonClient } from '@getpaseo/client';

const url = process.env.PASEO_WS_URL ?? 'ws://127.0.0.1:16767/ws';
const out = process.env.PROBE_OUT ?? '/tmp/paseo-live-stream.ndjson';
const durationMs = Number(process.env.PROBE_DURATION_MS ?? 600_000);

const client = new DaemonClient({
  url,
  clientId: `probe-live-${process.pid}`,
  clientType: 'cli',
  appVersion: 'paseo-transcript-probe/0.0.1',
  connectTimeoutMs: 30_000,
  reconnect: { enabled: false },
});

await client.connect();
appendFileSync(out, `${JSON.stringify({ probe: 'connected', url, at: new Date().toISOString() })}\n`);

client.on('agent_stream', (message) => {
  appendFileSync(out, `${JSON.stringify({ received_at: new Date().toISOString(), message })}\n`);
});

setTimeout(() => {
  appendFileSync(out, `${JSON.stringify({ probe: 'stopping', at: new Date().toISOString() })}\n`);
  process.exit(0);
}, durationMs);
