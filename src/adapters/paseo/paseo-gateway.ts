import type { ExecutionMcpServerConfig } from '../../application/ports/runtime-extension-binding.js';
import type { ManagedEnvironmentProvider } from '../../domain/environments/managed-environment-package.js';
import type {
  PaseoAgentStreamEvent,
  PaseoClientPort,
  PaseoCreatedAgent,
  PaseoFinishedAgent,
  PaseoProviderSubagentDescriptor,
  PaseoProviderSubagentTimeline,
  PaseoProviderSubagentUpdate,
  PaseoTimelinePage,
} from './paseo-client-port.js';
import type { PaseoModelDescriptor } from './model-selector.js';
import {
  isPaseoExplicitMissingSessionError,
  PaseoClientInspectionUnavailableError,
  PaseoProviderBindingStaleError,
  PaseoProviderErrorIndistinguishableAtBoundaryError,
} from './errors.js';

/**
 * Thin SDK/wire facade. It has no Product/Work/Team/RuntimeSession policy and
 * does not decide whether an external session should be created or reused.
 */
export class PaseoGateway {
  public constructor(private readonly client: PaseoClientPort) {}

  public connect(): Promise<void> {
    return this.client.connect();
  }

  public connectionStatus(): string {
    return this.client.connectionStatus();
  }

  public openWorkspace(cwd: string): Promise<string> {
    return this.client.openWorkspace(cwd);
  }

  public async createWorkspace(cwd: string): Promise<string> {
    if (!this.client.createIndependentWorkspace)
      throw new Error('Paseo independent workspace creation is unavailable.');
    return this.client.createIndependentWorkspace(cwd);
  }

  public setWorkspaceTitle(workspaceId: string, title: string): Promise<void> {
    return this.client.setWorkspaceTitle(workspaceId, title);
  }

  public listModels(
    provider: ManagedEnvironmentProvider,
    cwd: string,
  ): Promise<readonly PaseoModelDescriptor[]> {
    return this.client.listModels(provider, cwd);
  }

  public createAgent(input: {
    readonly provider: ManagedEnvironmentProvider;
    readonly cwd: string;
    readonly workspaceId: string;
    readonly model: string;
    readonly systemPrompt: string;
    readonly runId: string;
    readonly title?: string;
    readonly labels?: Readonly<Record<string, string>>;
    readonly mcpServers?: readonly ExecutionMcpServerConfig[];
  }): Promise<PaseoCreatedAgent> {
    // The pinned 0.1.x compatibility port still contains an initialPrompt
    // field, but the real SDK does not use it. Keeping it empty preserves the
    // create -> persist binding -> first prompt ordering invariant.
    return this.client.createAgent({
      ...input,
      initialPrompt: '',
    });
  }

  public send(agentId: string, prompt: string): Promise<void> {
    return this.client.sendAgentMessage(agentId, prompt);
  }

  public wait(agentId: string, timeoutMs: number): Promise<PaseoFinishedAgent> {
    return this.client.waitForFinish(agentId, timeoutMs);
  }

  public subscribeAgent(
    listener: (event: PaseoAgentStreamEvent) => void,
  ): (() => void) | undefined {
    return this.client.subscribeAgentStream?.(listener);
  }

  public subscribeProviderSubagents(
    listener: (update: PaseoProviderSubagentUpdate) => void,
  ): (() => void) | undefined {
    return this.client.subscribeProviderSubagentUpdates?.(listener);
  }

  public listProviderSubagents(
    parentAgentId: string,
  ): Promise<readonly PaseoProviderSubagentDescriptor[]> | null {
    return this.client.listProviderSubagents?.(parentAgentId) ?? null;
  }

  public fetchProviderSubagentTimeline(
    parentAgentId: string,
    subagentId: string,
  ): Promise<PaseoProviderSubagentTimeline> | null {
    return (
      this.client.fetchProviderSubagentTimeline?.(parentAgentId, subagentId, {
        direction: 'tail',
        limit: 100,
      }) ?? null
    );
  }

  public fetchTimeline(agentId: string): Promise<PaseoTimelinePage> | null {
    return (
      this.client.fetchAgentTimeline?.(agentId, {
        direction: 'tail',
        limit: 100,
        projection: 'projected',
      }) ?? null
    );
  }

  public async assertSessionAvailable(agentId: string): Promise<void> {
    const timeline = this.fetchTimeline(agentId);
    if (!timeline) throw new PaseoClientInspectionUnavailableError();
    try {
      await timeline;
    } catch (error) {
      if (isPaseoExplicitMissingSessionError(error))
        throw new PaseoProviderBindingStaleError();
      throw new PaseoProviderErrorIndistinguishableAtBoundaryError(error);
    }
  }

  public cancel(agentId: string): Promise<void> {
    return this.client.cancelAgent?.(agentId) ?? Promise.resolve();
  }

  public close(): Promise<void> {
    return this.client.close();
  }
}
