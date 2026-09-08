import {
  projectTranscript,
  type TranscriptEntry,
} from '@/features/run-trace/transcript-projection';
import type { Session } from '@/features/run-trace/run-trace-gateway';

/**
 * Pick the latest complete assistant turn from captured sessions.
 *
 * A transcript can contain cumulative assistant snapshots and several turns.
 * Projecting each session first gives every Work surface the same merged turn
 * boundaries as the transcript reader, rather than treating a raw snapshot or
 * result summary as the outcome.
 */
export function latestAssistantSegmentFromSessions(
  sessions: readonly Session[],
): string | null {
  let latest: { readonly text: string; readonly createdAt: string } | null =
    null;
  for (const session of sessions) {
    for (const entry of projectTranscript(
      session.entries as readonly TranscriptEntry[],
    )) {
      if (entry.event.kind !== 'assistant_text') continue;
      if (!latest || entry.event.created_at >= latest.createdAt) {
        latest = { text: entry.event.text, createdAt: entry.event.created_at };
      }
    }
  }
  return latest?.text ?? null;
}

export function recentWorkRunSummary(
  sessions: readonly Session[],
): string | null {
  // Keep this projector independent of locale/status presentation. Callers
  // derive the current capture-label fallback when they render the result.
  return latestAssistantSegmentFromSessions(sessions);
}
