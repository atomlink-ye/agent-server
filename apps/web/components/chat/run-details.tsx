import {
  selectCurrentLifecycle,
  selectTerminalLifecycle,
  selectUsageEntry,
} from '@/lib/stream-reducer';
import type { TimelineState, UsageMetrics } from '@/lib/stream-reducer';

export type ViewStatus =
  'loading' | 'idle' | 'running' | 'completed' | 'failed';

type RunDetailsProps = {
  readonly timeline: TimelineState;
  readonly status: ViewStatus;
  readonly sessionId?: string;
  readonly taskId?: string;
  readonly runId?: string;
  readonly connected: boolean;
};

export function RunDetails({
  timeline,
  status,
  sessionId,
  taskId,
  runId,
  connected,
}: RunDetailsProps) {
  const lifecycle = runId ? selectCurrentLifecycle(timeline, runId) : null;
  const terminal = runId ? selectTerminalLifecycle(timeline, runId) : null;
  const usage = runId ? selectUsageEntry(timeline, runId)?.usage : null;
  return (
    <aside className="run-details" aria-label="Run details">
      <p className="details-kicker">Run details</p>
      <dl>
        <div>
          <dt>Status</dt>
          <dd>{runStatus(lifecycle, terminal, status)}</dd>
        </div>
        <div>
          <dt>Lifecycle</dt>
          <dd>{lifecycleLabel(lifecycle, terminal, status)}</dd>
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

function runStatus(
  lifecycle: ReturnType<typeof selectCurrentLifecycle>,
  terminal: ReturnType<typeof selectTerminalLifecycle>,
  status: ViewStatus,
) {
  if (terminal?.status === 'succeeded') return 'Completed';
  if (terminal) return 'Failed';
  if (lifecycle?.status === 'started') return 'Working';
  return {
    loading: 'Connecting',
    idle: 'Ready',
    running: 'Working',
    completed: 'Completed',
    failed: 'Failed',
  }[status];
}

function lifecycleLabel(
  lifecycle: ReturnType<typeof selectCurrentLifecycle>,
  terminal: ReturnType<typeof selectTerminalLifecycle>,
  status: ViewStatus,
) {
  if (terminal?.status === 'succeeded') return 'Saved result';
  if (terminal) return 'Run ended';
  if (lifecycle?.status === 'started') return 'Output streaming';
  return {
    loading: 'Connecting',
    idle: 'Waiting',
    running: 'Output streaming',
    completed: 'Saved result',
    failed: 'Run ended',
  }[status];
}

function formatUsage(usage: UsageMetrics | null | undefined) {
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
