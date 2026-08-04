import { createHash } from 'node:crypto';
import type { TeamExecutionRepository } from '../ports/team-execution-repository.js';
import type { TeamToolContext } from './team-tool-context.js';
import { TeamContextError } from './team-tool-context.js';
import { AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS } from '../agents/built-in-skills.js';
import { AGENTIC_TEAM_LIMITS } from './team-policy-evaluator.js';
import type { RunEventRepository } from '../ports/run-events.js';
import type { TeamMessageRepository } from '../ports/team-message-repository.js';

export class TeamCommandService {
  public constructor(
    private readonly repo: TeamExecutionRepository,
    private readonly events: Pick<RunEventRepository, 'append'>,
    private readonly messages: TeamMessageRepository,
    private readonly wake?: Pick<
      import('./team-wake-reconciler.js').TeamWakeReconciler,
      'reconcileForRootTask'
    >,
  ) {}

  public async state(context: TeamToolContext) {
    const items = (
      await this.repo.findWorkItemsByTeamRunId(
        context.teamRun.id,
        context.owner,
      )
    ).sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
    return {
      status: context.teamRun.status,
      phase: context.teamRun.phase,
      member: {
        name: context.member.name,
        role: context.member.role,
        status: context.member.status,
      },
      limits: {
        max_work_items: AGENTIC_TEAM_LIMITS.maxWorkItems,
        max_attempts_per_work: AGENTIC_TEAM_LIMITS.maxAttemptsPerItem,
      },
      allowed_actions: context.allowedTools.map(logicalToolName),
      work_count: items.length,
    };
  }

  public async workList(context: TeamToolContext) {
    const items = (
      await this.repo.findWorkItemsByTeamRunId(
        context.teamRun.id,
        context.owner,
      )
    ).sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
    const members = await this.repo.findMembersByTeamRunId(
      context.teamRun.id,
      context.owner,
    );
    const attempts = await this.repo.findAttemptsByTeamRunId(
      context.teamRun.id,
      context.owner,
    );
    const dependencies = await this.repo.findWorkDependenciesByTeamRunId(
      context.teamRun.id,
      context.owner,
    );
    return [...items]
      .sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      )
      .map((item, index) => {
        const latest = attempts
          .filter((attempt) => attempt.workItemId === item.id)
          .sort((a, b) => b.attemptNo - a.attemptNo)[0];
        return {
          visible:
            context.member.role === 'lead' ||
            item.ownerMemberId === context.member.id,
          work_ref: `work-${index + 1}`,
          subject: safeText(item.subject),
          status: item.status,
          assignee:
            members.find((member) => member.id === item.ownerMemberId)?.name ??
            null,
          latest_attempt: latest
            ? { status: latest.status, summary: safeText(latest.resultSummary) }
            : null,
          dependency_refs: dependencies
            .filter((edge) => edge.workItemId === item.id)
            .map((edge) =>
              items.findIndex(
                (candidate) => candidate.id === edge.dependsOnWorkItemId,
              ),
            )
            .filter((dependencyIndex) => dependencyIndex >= 0)
            .map((dependencyIndex) => `work-${dependencyIndex + 1}`),
        };
      })
      .filter((item) => item.visible)
      .map(({ visible: _visible, ...item }) => item);
  }

  public async createWork(
    context: TeamToolContext,
    input: {
      subject: string;
      description?: string;
      assignee: string;
      dependencyRefs?: readonly string[];
    },
  ) {
    this.require(
      context,
      AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.workCreate,
      'lead',
    );
    const member = await this.assignee(context, input.assignee);
    const dependencyRefs = input.dependencyRefs ?? [];
    const dependsOnWorkItemIds = await Promise.all(
      dependencyRefs.map((ref) => this.resolveWorkRef(context, ref)),
    );
    if (new Set(dependsOnWorkItemIds).size !== dependsOnWorkItemIds.length)
      throw new TeamContextError('invalid_request');
    const result = await this.repo.createAssignedWork({
      teamRunId: context.teamRun.id,
      sourceRunId: context.run.id,
      leadTaskId: context.task.id,
      assigneeMemberId: member.id,
      subject: input.subject,
      description: input.description ?? null,
      dependsOnWorkItemIds,
      commandHash: hash('team_work_create', input),
      expectedRevision: context.teamRun.revision,
      owner: context.owner,
    });
    return {
      work_ref: await this.workRef(context, result.item.id),
      subject: safeText(result.item.subject),
      status: result.item.status,
      assignee: member.name,
      dependency_refs: dependencyRefs,
    };
  }

  public async accept(context: TeamToolContext, input: { workRef: string }) {
    this.require(context, AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.accept, 'lead');
    const workItemId = await this.resolveWorkRef(context, input.workRef);
    const result = await this.repo.acceptWork({
      teamRunId: context.teamRun.id,
      workItemId,
      sourceRunId: context.run.id,
      leadTaskId: context.task.id,
      commandHash: hash('team_work_accept', input),
      expectedRevision: context.teamRun.revision,
      owner: context.owner,
    });
    return { work_ref: input.workRef, status: result.status };
  }

  public async requestChanges(
    context: TeamToolContext,
    input: { workRef: string; assignee: string; feedback: string },
  ) {
    this.require(
      context,
      AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.requestChanges,
      'lead',
    );
    const member = await this.assignee(context, input.assignee);
    const workItemId = await this.resolveWorkRef(context, input.workRef);
    const result = await this.repo.requestRework({
      teamRunId: context.teamRun.id,
      workItemId,
      assigneeMemberId: member.id,
      feedback: input.feedback,
      sourceRunId: context.run.id,
      leadTaskId: context.task.id,
      commandHash: hash('team_work_request_changes', input),
      expectedRevision: context.teamRun.revision,
      owner: context.owner,
    });
    return {
      work_ref: input.workRef,
      attempt_no: result.attemptNo,
      status: result.status,
      assignee: member.name,
      feedback: safeText(result.feedback),
    };
  }

  public async finish(
    context: TeamToolContext,
    _input: Record<string, never> = {},
  ) {
    this.require(context, AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.finish, 'lead');
    await this.repo.requestCompletion({
      teamRunId: context.teamRun.id,
      sourceRunId: context.run.id,
      leadTaskId: context.task.id,
      commandHash: hash('team_finish', {}),
      expectedRevision: context.teamRun.revision,
      owner: context.owner,
    });
    return { requested: true };
  }

  public async checkpoint(
    context: TeamToolContext,
    input: { summary: string },
  ) {
    this.require(
      context,
      AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.checkpoint,
      'member',
    );
    const summary = safeText(input.summary);
    await this.events.append(context.run.id, 'output', {
      kind: 'team_checkpoint',
      summary,
      member: context.member.name,
      status: context.member.status,
    });
    return {
      checkpointed: true,
      summary,
      status: context.member.status,
    };
  }

  public async submit(context: TeamToolContext, input: { summary: string }) {
    this.require(
      context,
      AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.submit,
      'member',
    );
    const result = await this.repo.submitCurrentAttempt({
      teamRunId: context.teamRun.id,
      executionTaskId: context.task.id,
      currentRunId: context.run.id,
      memberId: context.member.id,
      resultSummary: safeText(input.summary) ?? '',
      owner: context.owner,
    });
    const item = await this.repo.findWorkItemById(
      result.workItemId,
      context.owner,
    );
    if (!item || item.teamRunId !== context.teamRun.id)
      throw new TeamContextError('not_found');
    return {
      work_ref: await this.workRef(context, item.id),
      submitted: true,
      status: result.status,
      summary: safeText(result.resultSummary),
    };
  }

  public async sendMessage(
    context: TeamToolContext,
    input: { recipient: string; summary: string },
  ) {
    this.require(
      context,
      AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.messageSend,
      'lead',
    );
    if (context.task.teamTaskKind !== 'lead_turn')
      throw new TeamContextError('not_allowed');
    const recipient = await this.assignee(context, input.recipient);
    if (recipient.id === context.member.id)
      throw new TeamContextError('invalid_request');
    const summary = safeText(input.summary);
    if (!summary) throw new TeamContextError('invalid_request');
    const message = await this.messages.sendDirect({
      teamRunId: context.teamRun.id,
      senderMemberRunId: context.member.id,
      recipientMemberRunId: recipient.id,
      dedupKey: `member:${recipient.id}:direct:${context.run.id}:${hash(
        'team_message_send',
        {
          recipient: recipient.name,
          summary,
        },
      )}`,
      body: summary,
      sourceTaskId: context.task.id,
      sourceRunId: context.run.id,
      expectedRevision: context.teamRun.revision,
      owner: context.owner,
    });
    await this.wake?.reconcileForRootTask(
      context.teamRun.rootTaskId,
      context.owner,
    );
    return {
      sent: true,
      recipient: recipient.name,
      summary: safeText(message.body),
    };
  }

  private require(
    context: TeamToolContext,
    tool: string,
    role: 'lead' | 'member',
  ) {
    if (context.member.role !== role || !context.allowedTools.includes(tool))
      throw new TeamContextError('not_allowed');
  }
  private async assignee(context: TeamToolContext, name: string) {
    const matches = (
      await this.repo.findMembersByTeamRunId(context.teamRun.id, context.owner)
    ).filter((member) => member.name === name && member.role === 'member');
    if (matches.length !== 1) throw new TeamContextError('not_found');
    return matches[0]!;
  }
  private async resolveWorkRef(context: TeamToolContext, workRef: string) {
    const match = /^work-(\d+)$/.exec(workRef);
    const items = (
      await this.repo.findWorkItemsByTeamRunId(
        context.teamRun.id,
        context.owner,
      )
    ).sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
    const index = match ? Number(match[1]) - 1 : -1;
    const item = index >= 0 ? items[index] : undefined;
    if (!item) throw new TeamContextError('not_found');
    return item.id;
  }

  private async workRef(context: TeamToolContext, workItemId: string) {
    const items = (
      await this.repo.findWorkItemsByTeamRunId(
        context.teamRun.id,
        context.owner,
      )
    ).sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
    const index = items.findIndex((item) => item.id === workItemId);
    if (index < 0) throw new TeamContextError('not_found');
    return `work-${index + 1}`;
  }
}

function safeText(value: string | null | undefined): string | null {
  return value === null || value === undefined
    ? null
    : value
        .replace(/bearer\s+(?:"[^"]*"|'[^']*'|[^\s]+)/gi, '[redacted]')
        .replace(
          /["']?\b(?:(?:access|refresh|id)[-_ ]?token|credential|token|password|secret|api[-_ ]?key)\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s]+)/gi,
          '[redacted]',
        )
        .replace(
          /(?:^|[\s"'=])(?:~\/|\/|[A-Za-z]:\\)[^\s"'`]+/g,
          '$1[redacted path]',
        )
        .replace(/[\u0000-\u001f\u007f]/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, 4096);
}

function logicalToolName(ref: string): string {
  return ref.startsWith('agent-server/')
    ? ref.slice('agent-server/'.length)
    : ref;
}

function hash(name: string, input: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify([name, input]))
    .digest('hex');
}
