import type { StreamProjection } from '@/lib/stream-reducer';

export type ViewStatus =
  'loading' | 'idle' | 'running' | 'completed' | 'failed';

type RunDetailsProps = {
  readonly projection: StreamProjection;
  readonly status: ViewStatus;
  readonly sessionId?: string;
  readonly taskId?: string;
  readonly runId?: string;
  readonly connected: boolean;
};

export function RunDetails({
  projection,
  status,
  sessionId,
  taskId,
  runId,
  connected,
}: RunDetailsProps) {
  const usage = projection.usage;
  return (
    <aside className="run-details" aria-label="Run details">
      <p className="details-kicker">Run details</p>
      <dl>
        <div>
          <dt>Status</dt>
          <dd>{runStatus(projection, status)}</dd>
        </div>
        <div>
          <dt>Lifecycle</dt>
          <dd>{lifecycleLabel(projection, status)}</dd>
        </div>
        <div>
          <dt>Live updates</dt>
          <dd>{connected ? 'Connected' : 'Not connected'}</dd>
        </div>
        <div>
          <dt>Usage</dt>
          <dd>{formatUsage(usage)}</dd>
        </div>
      </dl>
      <div className="read-only-card">
        <strong>▣ Read-only controls</strong>
        Permission events are visible as safe summaries. Approval actions are
        not available here.
      </div>
      <details className="developer-details">
        <summary>Session and developer details</summary>
        <div>
          <span>Session</span>
          <code>{shortId(sessionId)}</code>
          <span>Task</span>
          <code>{shortId(taskId)}</code>
          <span>Run</span>
          <code>{shortId(runId)}</code>
        </div>
      </details>
    </aside>
  );
}

function runStatus(projection: StreamProjection, status: ViewStatus) {
  if (projection.terminal === 'succeeded') return 'Completed';
  if (projection.terminal) return 'Failed';
  if (projection.lifecycle === 'started') return 'Working';
  return {
    loading: 'Connecting',
    idle: 'Ready',
    running: 'Working',
    completed: 'Completed',
    failed: 'Failed',
  }[status];
}

function lifecycleLabel(projection: StreamProjection, status: ViewStatus) {
  if (projection.terminal === 'succeeded') return 'Saved result';
  if (projection.terminal) return 'Run ended';
  if (projection.lifecycle === 'started') return 'Output streaming';
  return {
    loading: 'Connecting',
    idle: 'Waiting',
    running: 'Output streaming',
    completed: 'Saved result',
    failed: 'Run ended',
  }[status];
}

function formatUsage(usage: StreamProjection['usage']) {
  if (!usage) return 'Not available';
  const parts = [];
  if (usage.inputTokens !== undefined)
    parts.push(`${usage.inputTokens.toLocaleString()} in`);
  if (usage.outputTokens !== undefined)
    parts.push(`${usage.outputTokens.toLocaleString()} out`);
  if (usage.totalCostUsd !== undefined)
    parts.push(`$${usage.totalCostUsd.toFixed(4)}`);
  return parts.join(' · ') || 'Reported';
}

function shortId(value?: string) {
  return value ? `${value.slice(0, 8)}…` : 'Not available';
}
