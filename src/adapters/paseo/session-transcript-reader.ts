/**
 * Reads one team member's session transcript back out of Paseo, addressed by the name
 * the roster uses rather than by any Paseo identifier.
 *
 * The caller says "the analyst on this team run"; resolving that to a provider
 * agent id is this module's job, not the caller's. Read-only throughout: it
 * issues one SELECT and one timeline fetch, and writes nothing.
 *
 * Measured on a real three-role run (2026-08-18): a member's stored timeline is
 * still readable after the run has finished, so this does not have to be called
 * while the team is live.
 */

import {
  deriveSessionTranscriptOverview,
  orderEntries,
  projectTimelineEntry,
  type SessionTranscriptOverview,
  type SessionTranscriptEntry,
} from './session-transcript.js';

/** The Paseo-side identity of one roster member, resolved from our own tables. */
export interface SessionAgentBinding {
  readonly memberName: string;
  readonly role: string;
  readonly status: string;
  readonly providerAgentId: string;
}

export interface SessionAgentBindingLookup {
  /** Every member of a team run that has reached the point of owning an agent. */
  findBindings(teamRunId: string): Promise<readonly SessionAgentBinding[]>;
}

/**
 * The single Paseo call this module makes. Narrower than the full client on
 * purpose: a transcript reader has no business creating or messaging agents.
 */
export interface SessionTimelineSource {
  fetchAgentTimeline(
    agentId: string,
    options: {
      readonly direction: 'tail';
      readonly limit: number;
      readonly projection: 'projected';
    },
  ): Promise<{
    readonly epoch?: unknown;
    readonly entries?: unknown;
    /** True when this tail page omits older timeline entries. */
    readonly hasOlder?: unknown;
    /** Opaque cursor for fetching older entries; this reader deliberately does not follow it. */
    readonly startCursor?: unknown;
  }>;
}

export interface SessionTranscript {
  readonly teamRunId: string;
  readonly memberName: string;
  readonly role: string;
  readonly status: string;
  readonly providerAgentId: string;
  readonly epoch: string | null;
  /** True when `entries` is only the most recent tail of the transcript. */
  readonly hasOlder: boolean;
  /** Paseo's opaque cursor for older entries; pagination is intentionally not implemented here. */
  readonly cursor: unknown | null;
  readonly overview: SessionTranscriptOverview;
  readonly entries: readonly SessionTranscriptEntry[];
}

export class SessionTranscriptUnknownMemberError extends Error {
  public constructor(
    teamRunId: string,
    memberName: string,
    known: readonly string[],
  ) {
    // Name the members that do exist: the overwhelmingly common cause is a
    // typo or a member that has not started yet, and both are obvious from the list.
    super(
      `no member named "${memberName}" with a Paseo agent on team run ${teamRunId}` +
        (known.length
          ? `; members with agents: ${known.join(', ')}`
          : '; no member has an agent yet'),
    );
    this.name = 'SessionTranscriptUnknownMemberError';
  }
}

const DEFAULT_LIMIT = 200;

export class SessionTranscriptReader {
  public constructor(
    private readonly bindings: SessionAgentBindingLookup,
    private readonly timelines: SessionTimelineSource,
    private readonly limit: number = DEFAULT_LIMIT,
  ) {}

  /** Which roster members can be addressed - drives a picker without fetching any transcript. */
  public async listMembers(
    teamRunId: string,
  ): Promise<readonly SessionAgentBinding[]> {
    return this.bindings.findBindings(teamRunId);
  }

  public async read(input: {
    readonly teamRunId: string;
    readonly memberName: string;
  }): Promise<SessionTranscript> {
    const all = await this.bindings.findBindings(input.teamRunId);
    const binding = all.find((entry) => entry.memberName === input.memberName);
    if (!binding) {
      throw new SessionTranscriptUnknownMemberError(
        input.teamRunId,
        input.memberName,
        all.map((entry) => entry.memberName),
      );
    }
    return this.readBinding(input.teamRunId, binding);
  }

  /** Every roster member in one call, for the overview layer. */
  public async readAll(
    teamRunId: string,
  ): Promise<readonly SessionTranscript[]> {
    const all = await this.bindings.findBindings(teamRunId);
    return Promise.all(
      all.map((binding) => this.readBinding(teamRunId, binding)),
    );
  }

  async #fetch(providerAgentId: string) {
    return this.timelines.fetchAgentTimeline(providerAgentId, {
      direction: 'tail',
      limit: this.limit,
      projection: 'projected',
    });
  }

  private async readBinding(
    teamRunId: string,
    binding: SessionAgentBinding,
  ): Promise<SessionTranscript> {
    const page = await this.#fetch(binding.providerAgentId);
    const raw = Array.isArray(page.entries) ? page.entries : [];
    const entries = orderEntries(
      raw
        .map((entry) => projectTimelineEntry(entry))
        .filter((entry): entry is SessionTranscriptEntry => entry !== null),
    );
    return {
      teamRunId,
      memberName: binding.memberName,
      role: binding.role,
      status: binding.status,
      providerAgentId: binding.providerAgentId,
      epoch: typeof page.epoch === 'string' ? page.epoch : null,
      hasOlder: page.hasOlder === true,
      cursor: page.startCursor ?? null,
      entries,
      overview: deriveSessionTranscriptOverview({
        memberName: binding.memberName,
        role: binding.role,
        status: binding.status,
        providerAgentId: binding.providerAgentId,
        entries,
        hasOlder: page.hasOlder === true,
      }),
    };
  }
}
