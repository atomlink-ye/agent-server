import type { RunEventRepository } from '../ports/run-events.js';
import type { WorkIdentityOwnerScope } from '../ports/work-identity-repository.js';
import type { ProductSessionTranscriptFactsQuery } from './session-transcript-facts-source.js';
import {
  ProductProjectionNotFoundError,
  type ProductWorkIdentityQuery,
} from './product-projection.js';
import { projectRunEvent } from './get-product-execution-detail.js';
import {
  ProductSessionTranscriptsResponseSchema,
  type ProductSessionTranscriptsResponse,
} from '../../contracts/product-projection/session-transcripts.js';
import type { ProductExecutionDetailEvent } from '../../contracts/product-projection/execution-detail.js';

const MAX_SESSION_TRANSCRIPT_ENTRIES = 2_000;
const PAGE_SIZE = 100;

// MAX_SESSION_TRANSCRIPT_ENTRIES alone does not bound the emitted JSON size:
// a Team run's worth of tool/assistant entries average well over 1KB each
// (a real 26-minute Team run produced ~3.3KB/entry), so 2,000 entries can
// serialize to several megabytes. The browser BFF forwards this response
// verbatim and discards anything above its own byte cap rather than
// truncating it, so an oversized-but-valid projection is unreachable in the
// browser even though the authenticated API serves it fine. This budget
// keeps the entries this projection emits well under that transport cap
// (with headroom left for per-session label/summary bytes and JSON
// structural overhead) so the projection stays deliverable. This module must
// not import the transport's cap -- a transport detail -- so this number is
// chosen independently and is only obligated to stay comfortably below it.
const MAX_SESSION_TRANSCRIPT_BYTES = 700 * 1024;

export class GetProductSessionTranscripts {
  public constructor(
    private readonly workIdentity: Pick<
      ProductWorkIdentityQuery,
      'findWorkById' | 'findWorkRunById'
    >,
    private readonly sessionFacts: ProductSessionTranscriptFactsQuery,
    private readonly runEvents: Pick<RunEventRepository, 'list'>,
  ) {}

  public async execute(
    input: WorkIdentityOwnerScope & {
      readonly workId: string;
      readonly workRunId: string;
    },
  ): Promise<ProductSessionTranscriptsResponse> {
    const owner = { tenantId: input.tenantId, workspaceId: input.workspaceId };
    const [work, workRun] = await Promise.all([
      this.workIdentity.findWorkById(input.workId, owner),
      this.workIdentity.findWorkRunById(input.workRunId, owner),
    ]);
    if (
      !work ||
      !workRun ||
      workRun.workId !== work.id ||
      workRun.rootTaskId === null ||
      workRun.boundAt === null
    )
      throw new ProductProjectionNotFoundError();

    const streams = await this.sessionFacts.listByRootTask({
      ...owner,
      rootTaskId: workRun.rootTaskId,
    });
    const sessions = [];
    // Split the byte budget evenly across sessions up front, as a fixed
    // per-session allotment rather than a shared pool that shrinks as
    // sessions are processed in order. A shared pool would let whichever
    // session is iterated first (e.g. a Team lead with 2,000 entries)
    // consume the whole budget and starve every session behind it; an equal
    // split guarantees a quiet member's small share is never touched by a
    // noisy member's overflow.
    const perSessionByteBudget = Math.floor(
      MAX_SESSION_TRANSCRIPT_BYTES / Math.max(streams.length, 1),
    );
    for (const stream of streams) {
      const entries: ProductExecutionDetailEvent[] = [];
      let truncated = false;
      let entryBytes = 0;
      let byteBudgetExhausted = false;
      for (const [runIndex, run] of stream.runs.entries()) {
        let after = 0;
        while (
          entries.length < MAX_SESSION_TRANSCRIPT_ENTRIES &&
          !byteBudgetExhausted
        ) {
          const page = await this.runEvents.list(run.runId, after, PAGE_SIZE);
          for (const [eventIndex, event] of page.events.entries()) {
            const projected = projectRunEvent(event);
            // Cost each entry from its own serialized size once. Re-serializing
            // the whole accumulated `entries` array on every iteration would
            // make this loop O(n^2) in the entry count.
            const projectedBytes = Buffer.byteLength(JSON.stringify(projected));
            if (entryBytes + projectedBytes > perSessionByteBudget) {
              // The entry we declined to add is a real entry that exists,
              // so there is unambiguously more transcript than is shown.
              // This keeps the oldest entries and drops the newest, matching
              // the pre-existing entry-count truncation immediately below:
              // both walk runs oldest-first via forward, after-cursor
              // pagination (RunEventRepository.list has no reverse/tail
              // pagination), so retaining the tail instead would require a
              // new backward-pagination port method -- a larger change than
              // this defect fix warrants.
              truncated = true;
              byteBudgetExhausted = true;
              break;
            }
            entries.push(projected);
            entryBytes += projectedBytes;
            if (entries.length >= MAX_SESSION_TRANSCRIPT_ENTRIES) {
              truncated =
                eventIndex < page.events.length - 1 ||
                (await hasMoreRunEvents(
                  this.runEvents,
                  run.runId,
                  event.sequence,
                )) ||
                (await hasMoreRuns(
                  this.runEvents,
                  stream.runs.slice(runIndex + 1),
                ));
              break;
            }
          }
          if (
            entries.length >= MAX_SESSION_TRANSCRIPT_ENTRIES ||
            byteBudgetExhausted
          ) {
            break;
          }
          if (page.nextCursor === null || page.nextCursor <= after) break;
          after = page.nextCursor;
        }
        if (
          entries.length >= MAX_SESSION_TRANSCRIPT_ENTRIES ||
          byteBudgetExhausted
        )
          break;
      }

      entries.sort(
        (left, right) =>
          left.created_at.localeCompare(right.created_at) ||
          left.sequence - right.sequence,
      );
      const responseEntries = entries.map((entry, index) => ({
        ordinal: index + 1,
        ...entry,
      }));
      const lastMeaningful =
        [...responseEntries]
          .reverse()
          .map(lastMeaningfulEntry)
          .find((entry) => entry !== null) ?? null;
      const lastTimestamp =
        responseEntries[responseEntries.length - 1]?.created_at ?? null;
      sessions.push({
        label: {
          name: stream.name,
          role: stream.role,
          status: stream.status,
          status_basis: stream.statusBasis,
          source_refs: {
            ...(stream.sourceRefs.teamMemberRunId
              ? { team_member_run_id: stream.sourceRefs.teamMemberRunId }
              : {}),
            ...(stream.sourceRefs.taskId
              ? { task_id: stream.sourceRefs.taskId }
              : {}),
          },
        },
        summary: {
          status: stream.status,
          entry_count: responseEntries.length,
          last_timestamp: lastTimestamp,
          last_meaningful: lastMeaningful,
          work_refs: workRefs(responseEntries),
          truncated,
        },
        entries: responseEntries,
      });
    }

    return ProductSessionTranscriptsResponseSchema.parse({
      work_id: work.id,
      work_run_id: workRun.id,
      capture_scope: 'safe_run_events',
      sessions,
    });
  }
}

async function hasMoreRunEvents(
  runEvents: Pick<RunEventRepository, 'list'>,
  runId: string,
  after: number,
): Promise<boolean> {
  const page = await runEvents.list(runId, after, 1);
  return page.events.length > 0;
}

async function hasMoreRuns(
  runEvents: Pick<RunEventRepository, 'list'>,
  runs: readonly { readonly runId: string }[],
): Promise<boolean> {
  for (const run of runs) {
    if (await hasMoreRunEvents(runEvents, run.runId, 0)) return true;
  }
  return false;
}

type TranscriptEntry = ProductExecutionDetailEvent & {
  readonly ordinal: number;
};
type Meaningful = {
  readonly kind: string;
  readonly timestamp: string;
  readonly action: string | null;
  readonly result: string | null;
};

function lastMeaningfulEntry(entry: TranscriptEntry): Meaningful | null {
  if (entry.kind === 'assistant_text')
    return {
      kind: entry.kind,
      timestamp: entry.created_at,
      action: null,
      result: entry.text,
    };
  if (entry.kind === 'tool_status')
    return {
      kind: entry.kind,
      timestamp: entry.created_at,
      action: entry.tool_name ?? entry.label ?? entry.category,
      result: entry.detail_text ?? entry.summary ?? entry.status,
    };
  if (entry.kind === 'permission')
    return {
      kind: entry.kind,
      timestamp: entry.created_at,
      action: entry.category,
      result: entry.summary,
    };
  return null;
}

const WORK_REF_PATTERN = /(?:^|[^A-Za-z0-9_])(W-[1-9]\d*)(?![A-Za-z0-9_])/gu;

function workRefs(entries: readonly TranscriptEntry[]): readonly string[] {
  const refs = new Set<string>();
  for (const entry of entries) {
    const value = JSON.stringify(entry);
    for (const match of value.matchAll(WORK_REF_PATTERN)) {
      if (match[1]) refs.add(match[1]);
      if (refs.size >= 256) return [...refs];
    }
  }
  return [...refs];
}
