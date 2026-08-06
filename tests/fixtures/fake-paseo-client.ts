import type {
  PaseoClientPort,
  PaseoCreatedAgent,
  PaseoFinishedAgent,
} from '../../src/adapters/paseo/paseo-client-port.js';
import type { PaseoModelDescriptor } from '../../src/adapters/paseo/model-selector.js';
import type { ManagedEnvironmentProvider } from '../../src/domain/environments/managed-environment-package.js';

export class FakePaseoClient implements PaseoClientPort {
  public connectCalls = 0;
  public openWorkspaceCalls = 0;
  public titleCalls = 0;
  public listModelsCalls = 0;
  public createAgentCalls = 0;
  public waitCalls = 0;
  public closeCalls = 0;
  public status = 'idle';
  public connectHook: ((call: number) => Promise<void>) | null = null;
  public listModelsError: Error | null = null;
  public models: readonly PaseoModelDescriptor[] = [
    { id: 'opencode/deepseek-v4-flash-free', label: 'DeepSeek V4 Flash Free' },
  ];
  public finished: PaseoFinishedAgent = {
    status: 'idle',
    error: null,
    lastMessage: 'PASEO_FAKE_OK',
    usage: { inputTokens: 4, outputTokens: 3, totalCostUsd: 0 },
  };

  public async connect(): Promise<void> {
    this.connectCalls += 1;
    await this.connectHook?.(this.connectCalls);
    this.status = 'connected';
  }

  public connectionStatus(): string {
    return this.status;
  }

  public async openWorkspace(): Promise<string> {
    this.openWorkspaceCalls += 1;
    return 'workspace-1';
  }

  public async setWorkspaceTitle(): Promise<void> {
    this.titleCalls += 1;
  }

  public async listModels(
    _provider: ManagedEnvironmentProvider,
    _cwd: string,
  ): Promise<readonly PaseoModelDescriptor[]> {
    this.listModelsCalls += 1;
    if (this.listModelsError) {
      throw this.listModelsError;
    }
    return this.models;
  }

  public async createAgent(_input: {
    readonly provider: ManagedEnvironmentProvider;
  }): Promise<PaseoCreatedAgent> {
    this.createAgentCalls += 1;
    return {
      id: 'agent-1',
      provider: 'opencode',
      model: 'opencode/deepseek-v4-flash-free',
    };
  }

  public async waitForFinish(): Promise<PaseoFinishedAgent> {
    this.waitCalls += 1;
    return this.finished;
  }

  public async sendAgentMessage(): Promise<void> {}

  public async close(): Promise<void> {
    this.closeCalls += 1;
    this.status = 'disposed';
  }
}
