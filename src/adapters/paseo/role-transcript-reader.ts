/**
 * Reads one team member's transcript back out of Paseo, addressed by the name
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
  orderEntries,
  projectTimelineEntry,
  type RoleTranscriptEntry,
} from './role-transcript.js';

/** The Paseo-side identity of one roster member, resolved from our own tables. */
export interface RoleAgentBinding {
  readonly memberName: string;
  readonly role: string;
  readonly status: string;
  readonly providerAgentId: string;
}

export interface RoleAgentBindingLookup {
  /** Every member of a team run that has reached the point of owning an agent. */
  findBindings(teamRunId: string): Promise<readonly RoleAgentBinding[]>;
}

/**
 * The single Paseo call this module makes. Narrower than the full client on
 * purpose: a transcript reader has no business creating or messaging agents.
 */
export interface RoleTimelineSource {
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
  }>;
}

export interface RoleTranscript {
  readonly teamRunId: string;
  readonly memberName: string;
  readonly role: string;
  readonly status: string;
  readonly providerAgentId: string;
  readonly epoch: string | null;
  readonly entries: readonly RoleTranscriptEntry[];
}

export class RoleTranscriptUnknownMemberError extends Error {
  public constructor(teamRunId: string, memberName: string, known: readonly string[]) {
    // Name the members that do exist: the overwhelmingly common cause is a
    // typo or a member that has not started yet, and both are obvious from the list.
    super(
      `no member named "${memberName}" with a Paseo agent on team run ${teamRunId}` +
        (known.length ? `; members with agents: ${known.join(', ')}` : '; no member has an agent yet'),
    );
    this.name = 'RoleTranscriptUnknownMemberError';
  }
}

const DEFAULT_LIMIT = 200;

export class RoleTranscriptReader {
  public constructor(
    private readonly bindings: RoleAgentBindingLookup,
    private readonly timelines: RoleTimelineSource,
    private readonly limit: number = DEFAULT_LIMIT,
  ) {}

  /** Which roles can be asked for - drives a picker without fetching any transcript. */
  public async listRoles(teamRunId: string): Promise<readonly RoleAgentBinding[]> {
    return this.bindings.findBindings(teamRunId);
  }

  public async read(input: {
    readonly teamRunId: string;
    readonly memberName: string;
  }): Promise<RoleTranscript> {
    const all = await this.bindings.findBindings(input.teamRunId);
    const binding = all.find((entry) => entry.memberName === input.memberName);
    if (!binding) {
      throw new RoleTranscriptUnknownMemberError(
        input.teamRunId,
        input.memberName,
        all.map((entry) => entry.memberName),
      );
    }
    return this.readBinding(input.teamRunId, binding);
  }

  /** Every role in one call, for the overview layer. */
  public async readAll(teamRunId: string): Promise<readonly RoleTranscript[]> {
    const all = await this.bindings.findBindings(teamRunId);
    return Promise.all(all.map((binding) => this.readBinding(teamRunId, binding)));
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
    binding: RoleAgentBinding,
  ): Promise<RoleTranscript> {
    const page = await this.#fetch(binding.providerAgentId);
    const raw = Array.isArray(page.entries) ? page.entries : [];
    const entries = orderEntries(
      raw
        .map((entry) => projectTimelineEntry(entry))
        .filter((entry): entry is RoleTranscriptEntry => entry !== null),
    );
    return {
      teamRunId,
      memberName: binding.memberName,
      role: binding.role,
      status: binding.status,
      providerAgentId: binding.providerAgentId,
      epoch: typeof page.epoch === 'string' ? page.epoch : null,
      entries,
    };
  }
}
