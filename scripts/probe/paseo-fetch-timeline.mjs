// READ-ONLY probe. For each agent id given on argv, calls the SDK's public
// fetchAgentTimeline and prints the raw page as JSON. No projection, no
// filtering: whatever the daemon returns is what gets printed.
import { DaemonClient } from '@getpaseo/client';

const url = process.env.PASEO_WS_URL ?? 'ws://127.0.0.1:16767/ws';
const agentIds = process.argv.slice(2);
if (agentIds.length === 0) throw new Error('usage: paseo-fetch-timeline.mjs <agentId...>');

const client = new DaemonClient({
  url,
  clientId: `probe-timeline-${process.pid}`,
  clientType: 'cli',
  appVersion: 'paseo-transcript-probe/0.0.1',
  connectTimeoutMs: 30_000,
  reconnect: { enabled: false },
});
await client.connect();

for (const agentId of agentIds) {
  try {
    const page = await client.fetchAgentTimeline(agentId, {
      direction: 'tail',
      limit: 200,
      projection: 'projected',
    });
    process.stdout.write(`${JSON.stringify({ agentId, ok: true, page })}\n`);
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ agentId, ok: false, error: error instanceof Error ? error.message : String(error) })}\n`,
    );
  }
}
await client.close();
