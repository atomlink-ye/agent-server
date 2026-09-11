import type { TaskRepository } from '../ports/task-repository.js';
import type { TeamExecutionRepository } from '../ports/team-execution-repository.js';
import { randomUUID, createHash } from 'node:crypto';
import type { ExecuteRuntimeTurn } from '../runtime/execute-runtime-turn.js';
import type { EnsureDesiredRuntimeSpec } from '../ports/ensure-desired-runtime-spec.js';
import type {
  WorkChatRepository,
  WorkChatClaim,
  WorkChatOwner,
} from '../ports/work-chat-repository.js';
import type { WorkIdentityApi } from '../work/work-identity-api.js';
import type { WorkDefinitionResolutionPort } from '../ports/work-definition-resolution.js';
import type { WorkerResolutionApi } from '../ports/worker-registry.js';
import type { AppConfig } from '../../shared/config.js';
import { createDesiredRuntimeSystemPrompt } from '../../domain/runtime/desired-runtime-system-prompt.js';
import type { RuntimeTurnId } from '../../domain/runtime/runtime-session.js';
import type {
  StepWorker,
  WorkerStepResult,
} from '../../shared/workers/step-worker.js';
import type { AccessContext } from '../../domain/access-context.js';
import type { RuntimeTurnStore } from '../ports/runtime-turn-store.js';
import type { WorkPreparationService } from '../work/work-preparation-service.js';
import type { ProductWorkInputSchema } from '../work/validate-product-work-definition.js';

export interface WorkChatWorkerOptions {
  readonly workerId: string;
  readonly leaseMs: number;
  readonly pollIntervalMs?: number;
  readonly ownerPrincipalType: AccessContext['principalType'];
  readonly ownerPrincipalId: string;
  readonly config: Pick<AppConfig, 'paseo'>;
  readonly now?: () => Date;
}

export interface WorkChatWorkerDependencies {
  readonly repository: WorkChatRepository;
  readonly workIdentity: Pick<WorkIdentityApi, 'findWorkById' | 'getWorkRun'>;
  readonly tasks: Pick<TaskRepository, 'findByIdForOwner'>;
  readonly teams: Pick<
    TeamExecutionRepository,
    'findTeamRunByRootTaskId' | 'findMembersByTeamRunId'
  >;
  readonly definitions: WorkDefinitionResolutionPort;
  readonly workers: WorkerResolutionApi;
  readonly desiredSpec: Pick<EnsureDesiredRuntimeSpec, 'execute'>;
  readonly turnExecutor: Pick<ExecuteRuntimeTurn, 'execute'>;
  readonly runtimeTurns: Pick<RuntimeTurnStore, 'findById'>;
  readonly preparations?: Pick<
    WorkPreparationService,
    'observeLead' | 'getIntakeContext'
  >;
}

/** Drains preparation and Run conversations using their scoped executors. */
export class WorkChatWorker implements StepWorker {
  #running = false;
  #stopping = false;
  #loop: Promise<void> | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #wake: (() => void) | null = null;
  readonly #options: Required<
    Pick<
      WorkChatWorkerOptions,
      | 'workerId'
      | 'leaseMs'
      | 'ownerPrincipalType'
      | 'ownerPrincipalId'
      | 'config'
    >
  > & { pollIntervalMs: number; now: () => Date };

  public constructor(
    private readonly dependencies: WorkChatWorkerDependencies,
    options: WorkChatWorkerOptions,
  ) {
    this.#options = {
      ...options,
      pollIntervalMs: options.pollIntervalMs ?? 250,
      now: options.now ?? (() => new Date()),
    };
  }
  public start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#stopping = false;
    this.#loop = this.loop().catch(() => undefined);
  }
  public async stop(): Promise<void> {
    this.#stopping = true;
    this.#running = false;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.#wake?.();
    this.#wake = null;
    await this.#loop;
    this.#loop = null;
  }
  public async step(): Promise<WorkerStepResult> {
    const claim = await this.dependencies.repository.claimNext({
      workerId: this.#options.workerId,
      leaseMs: this.#options.leaseMs,
      now: this.#options.now().toISOString(),
    });
    if (!claim) return { kind: 'idle' };
    try {
      await this.reply(claim);
    } catch (error) {
      const recovered = await this.recoverCompletedTurn(claim).catch(
        () => false,
      );
      if (recovered) return { kind: 'processed', value: claim };
      await this.dependencies.repository
        .fail({
          id: claim.id,
          workerId: this.#options.workerId,
          leaseFence: claim.leaseFence,
          failureCode: safeFailureCode(error),
          updatedAt: this.#options.now().toISOString(),
        })
        .catch(() => undefined);
    }
    return { kind: 'processed', value: claim };
  }
  private async recoverCompletedTurn(claim: WorkChatClaim): Promise<boolean> {
    const turn = await this.dependencies.runtimeTurns.findById(
      workChatTurnId(claim.workId, claim.id),
    );
    if (turn?.status !== 'succeeded' || turn.outputText === null) return false;
    const owner: WorkChatOwner = {
      tenantId: claim.tenantId,
      workspaceId: claim.workspaceId,
      principalType: this.#options.ownerPrincipalType,
      principalId: this.#options.ownerPrincipalId,
    };
    const accessContext: AccessContext = {
      tenantId: owner.tenantId,
      workspaceId: owner.workspaceId,
      principalType: this.#options.ownerPrincipalType,
      principalId: this.#options.ownerPrincipalId,
      policySnapshotVersion: 'work-chat',
    };
    const lead = parseLeadOutput(turn.outputText);
    if (!claim.workRunId && this.dependencies.preparations) {
      await this.dependencies.preparations.observeLead({
        owner,
        workId: claim.workId,
        accessContext,
        candidateInput: lead.candidateInput,
        missing: lead.missing,
        ambiguities: lead.ambiguities,
        sourceMessageId: claim.id,
      });
    }
    const now = this.#options.now().toISOString();
    const completed = await this.dependencies.repository.complete({
      id: claim.id,
      workerId: this.#options.workerId,
      leaseFence: claim.leaseFence,
      reply: {
        id: cryptoRandomUuid(),
        body: lead.replyText,
        sourceRuntimeTurnId: turn.id,
        createdAt: now,
      },
      updatedAt: now,
    });
    return Boolean(completed);
  }
  async #delay(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.#wake = resolve;
      this.#timer = setTimeout(resolve, this.#options.pollIntervalMs);
    });
    this.#wake = null;
    this.#timer = null;
  }
  async loop(): Promise<void> {
    while (!this.#stopping) {
      await this.step();
      if (!this.#stopping) await this.#delay();
    }
  }
  private async reply(claim: WorkChatClaim): Promise<void> {
    const owner: WorkChatOwner = {
      tenantId: claim.tenantId,
      workspaceId: claim.workspaceId,
      principalType: this.#options.ownerPrincipalType,
      principalId: this.#options.ownerPrincipalId,
    };
    const work = await this.dependencies.workIdentity.findWorkById(
      claim.workId,
      owner,
    );
    if (!work) throw new Error('work_not_found');
    const accessContext: AccessContext = {
      tenantId: owner.tenantId,
      workspaceId: owner.workspaceId,
      principalType: this.#options.ownerPrincipalType,
      principalId: owner.principalId,
      policySnapshotVersion: 'work-chat',
    };
    let workerVersionId: string;
    let runContext: string | null = null;
    if (claim.workRunId) {
      const run = await this.dependencies.workIdentity.getWorkRun(
        claim.workRunId,
        owner,
      );
      if (!run || run.workId !== claim.workId)
        throw new Error('work_run_not_found');
      if (!run.rootTaskId) throw new Error('work_run_executor_unavailable');
      const record = await this.dependencies.tasks.findByIdForOwner(
        run.rootTaskId,
        owner,
      );
      if (!record) throw new Error('work_run_executor_unavailable');
      if (record.task.invokableKind === 'worker') {
        workerVersionId = record.task.invokableVersionId;
        runContext = `Run ${run.id}; execution status: ${record.latestRun?.status ?? record.task.status}.`;
      } else if (record.task.invokableKind === 'team') {
        const team = await this.dependencies.teams.findTeamRunByRootTaskId(
          run.rootTaskId,
          owner,
        );
        if (!team) throw new Error('work_run_executor_unavailable');
        const members = await this.dependencies.teams.findMembersByTeamRunId(
          team.id,
          owner,
        );
        const leads = members.filter((member) => member.role === 'lead');
        if (leads.length !== 1)
          throw new Error('work_run_executor_unavailable');
        workerVersionId = leads[0]!.workerVersionId;
        runContext = `Run ${run.id}; team status: ${team.status}.`;
      } else {
        throw new Error('work_run_executor_unavailable');
      }
    } else {
      const definition = await this.dependencies.definitions.resolve({
        definitionId: work.definitionId,
        definitionVersionId: work.currentDefinitionVersionId,
        accessContext,
      });
      const participant = definition.participants.find(
        (item) => item.role === 'primary' || item.role === 'lead',
      );
      if (!participant) throw new Error('work_chat_lead_unavailable');
      workerVersionId = participant.workerVersionId;
    }
    const worker = await this.dependencies.workers.resolvePublished(
      workerVersionId,
      owner,
      { resolveExtensions: true },
    );
    if (!worker) throw new Error('work_chat_lead_unavailable');
    const messages = await this.dependencies.repository.list({
      owner,
      workId: claim.workId,
      workRunId: claim.workRunId ?? undefined,
      limit: 80,
    });
    const transcript = messages
      .map(
        (message) =>
          `${message.sequence} ${message.kind === 'lead' ? 'Lead' : 'User'}: ${message.body}`,
      )
      .join('\n');
    const intake =
      !claim.workRunId && this.dependencies.preparations
        ? await this.dependencies.preparations.getIntakeContext({
            owner,
            workId: claim.workId,
            accessContext,
          })
        : null;
    const systemPrompt = createDesiredRuntimeSystemPrompt(
      [
        worker.instructions,
        runContext
          ? `You are the executor's conversational counterpart for this Run only. ${runContext} This is an isolated, read-only conversation, not the live execution session. You have only the state and conversation provided here; do not claim access to execution history or results not supplied.`
          : 'You are the temporary Lead for preparation before a Work Run.',
        'Reply to the latest User message using the shared transcript below.',
        'Return only JSON: {"reply":"...","candidate_input":{},"missing":[],"ambiguities":[]}. candidate_input must contain only fields you actually collected. Do not use tools, start a WorkRun, or claim that execution changed.',
        runContext
          ? 'Do not collect preparation input. Keep candidate_input empty. Answer about this Run only; you cannot steer, resume, or change its execution.'
          : renderWorkChatInputSchemaPrompt(intake?.schema),
        `Shared Work Chat transcript:\n${transcript}`,
      ].join('\n\n'),
    );
    const ensured = await this.dependencies.desiredSpec.execute({
      owner,
      scope: claim.workRunId
        ? { kind: 'work_run_chat', id: claim.workRunId }
        : { kind: 'work_chat', id: claim.workId },
      subject: { kind: 'worker', workerVersionId: workerVersionId },
      environmentVersionId: null,
      resolvedSkills: [],
      toolRefs: [],
      configuration: {
        provider: this.#options.config.paseo.provider,
        model: this.#options.config.paseo.model ?? null,
        cwd: this.#options.config.paseo.agentCwd,
        contextEpoch: 0,
        desiredSystemPrompt: systemPrompt,
      },
    });
    const turnId = workChatTurnId(claim.workId, claim.id);
    const output = await this.dependencies.turnExecutor.execute({
      runtimeSessionId: ensured.session.id,
      source: { kind: 'work_chat', workId: claim.workId, messageId: claim.id },
      turnId,
      prompt: claim.body,
      recoveryPrompt: claim.body,
      desiredSystemPrompt: systemPrompt,
    });
    const lead = parseLeadOutput(output.text);
    if (!claim.workRunId && this.dependencies.preparations) {
      await this.dependencies.preparations.observeLead({
        owner,
        workId: claim.workId,
        accessContext,
        candidateInput: lead.candidateInput,
        missing: lead.missing,
        ambiguities: lead.ambiguities,
        sourceMessageId: claim.id,
      });
    }
    const completed = await this.dependencies.repository.complete({
      id: claim.id,
      workerId: this.#options.workerId,
      leaseFence: claim.leaseFence,
      reply: {
        id: cryptoRandomUuid(),
        body: lead.replyText,
        sourceRuntimeTurnId: turnId,
        createdAt: this.#options.now().toISOString(),
      },
      updatedAt: this.#options.now().toISOString(),
    });
  }
}

export function renderWorkChatInputSchemaPrompt(
  schema: ProductWorkInputSchema | undefined,
): string {
  if (!schema)
    return 'No typed input schema is available. Do not invent candidate_input fields; keep it empty.';
  return [
    'The current Definition input schema is authoritative for candidate_input.',
    'candidate_input may contain only these declared properties; schema-external context belongs in reply/missing, never candidate_input.',
    JSON.stringify({
      properties: schema.properties,
      required: schema.required,
      additional_properties: schema.additional_properties,
    }),
  ].join('\n');
}

export interface ParsedWorkChatLeadReply {
  readonly replyText: string;
  readonly candidateInput: Readonly<Record<string, unknown>>;
  readonly missing: readonly string[];
  readonly ambiguities: readonly string[];
}

/** Accepts only the bounded envelope; arbitrary model prose remains safe text. */
export function parseLeadOutput(text: string): ParsedWorkChatLeadReply {
  const fallback = {
    replyText: text.trim() || 'I could not produce a reply.',
    candidateInput: {},
    missing: [],
    ambiguities: [],
  } as const;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return fallback;
    const value = parsed as Record<string, unknown>;
    if (typeof value.reply !== 'string' || !value.reply.trim()) return fallback;
    const candidate = value.candidate_input;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
      return fallback;
    const list = (input: unknown): readonly string[] =>
      Array.isArray(input) && input.every((item) => typeof item === 'string')
        ? input
        : [];
    return {
      replyText: value.reply.trim(),
      candidateInput: candidate as Record<string, unknown>,
      missing: list(value.missing),
      ambiguities: list(value.ambiguities),
    };
  } catch {
    return fallback;
  }
}

function cryptoRandomUuid(): string {
  return randomUUID();
}
function safeFailureCode(error: unknown): string {
  return error instanceof Error && /^[a-z0-9_:-]{1,80}$/u.test(error.message)
    ? error.message
    : 'work_chat_reply_failed';
}
export function workChatTurnId(
  workId: string,
  messageId: string,
): RuntimeTurnId {
  const hex = createHash('sha256')
    .update(`work-chat:${workId}:${messageId}`)
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0')}${hex.slice(18, 20)}-${hex.slice(20, 32)}` as RuntimeTurnId;
}
