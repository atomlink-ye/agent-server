import type { RunUsage } from '../../domain/runs/run.js';
import type { RuntimeInvocationContext } from '../../domain/runtime/runtime-invocation-context.js';
import type { ResourceOwner } from '../../domain/tenancy/product-context.js';
import type {
  ExecutionExtensionBinding,
  ExecutionObservationSink,
  ExecutionPlaneHealth,
  ExecutionSessionBinding,
  ExecutionWorkspaceBinding,
} from './execution-plane.js';
import type { RuntimeMemoryCandidate } from './runtime-memory-candidate-collector.js';
import type { RuntimeSession } from '../../domain/runtime/runtime-session.js';

export type ExecutionWorkspaceOwner =
  | {
      readonly kind: 'product_session';
      readonly id: string;
      readonly tenantId: string;
      readonly productWorkspaceId: string;
      readonly principalType: string;
      readonly principalId: string;
    }
  | {
      readonly kind: 'team_run';
      readonly id: string;
      readonly tenantId: string;
      readonly productWorkspaceId: string;
      readonly principalType: string;
      readonly principalId: string;
    };

export interface ExecutionTurnRequest {
  readonly runId: string;
  readonly prompt: string;
  readonly recoveryPrompt?: string;
  readonly runtimeSessionId?: string;
  readonly cwd?: string;
  readonly workspaceBinding?: ExecutionWorkspaceBinding;
  readonly workspaceOwner?: ExecutionWorkspaceOwner;
  readonly requireExistingWorkspaceBinding?: boolean;
  readonly compatibilitySessionBinding?: ExecutionSessionBinding;
  readonly workspaceTitle?: string;
  readonly sessionTitle?: string;
  readonly labels?: Readonly<Record<string, string>>;
  readonly provider?: string;
  readonly model?: string;
  readonly systemPrompt?: string;
  readonly extensions?: ExecutionExtensionBinding;
  readonly invocationContext?: RuntimeInvocationContext;
  readonly proposalLimit?: number;
}

export interface ExecutionTurnOutcome {
  readonly provider: string;
  readonly model: string;
  readonly text: string;
  readonly workspaceBinding: ExecutionWorkspaceBinding;
  readonly sessionBinding: ExecutionSessionBinding;
  readonly sessionResolution?:
    | 'created'
    | 'reused'
    | 'reconfigured'
    | 'replaced';
  readonly usedRecoveryPrompt?: boolean;
  readonly usage?: RunUsage;
  readonly memoryCandidates?: readonly RuntimeMemoryCandidate[];
}

export interface ExecutionRuntimeService {
  ensureReady(): Promise<boolean>;
  ensureAgentChatRuntimeSession(input: {
    readonly agentChatRuntimeId: string;
    readonly runtimeEpoch: number;
    readonly agentOwner: ResourceOwner;
    readonly agentVersionId: string;
    readonly resolvedSkills: readonly { readonly ref: string; readonly digest: string }[];
    readonly toolRefs: readonly string[];
  }): Promise<RuntimeSession>;
  executeTurn(
    input: ExecutionTurnRequest,
    observer?: ExecutionObservationSink,
  ): Promise<ExecutionTurnOutcome>;
  cancelRun(input: {
    readonly runId: string;
    readonly compatibilitySessionBinding?: ExecutionSessionBinding;
  }): Promise<void>;
  planeHealth(): Promise<ExecutionPlaneHealth>;
  close(): Promise<void>;
}
