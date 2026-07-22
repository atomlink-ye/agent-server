import type { AgentRuntimePort } from '../ports/agent-runtime.js';

export interface ReadinessCheckResult {
  readonly name: string;
  readonly ready: boolean;
  readonly detail?: string;
}

export interface ReadinessProbe {
  check(): Promise<readonly ReadinessCheckResult[]>;
}

export const noExternalDependencies: ReadinessProbe = {
  async check() {
    return [];
  },
};

export class RuntimeReadinessProbe implements ReadinessProbe {
  public constructor(private readonly runtime: AgentRuntimePort) {}

  public async check(): Promise<readonly ReadinessCheckResult[]> {
    const health = await this.runtime.health();
    return health.checks;
  }
}
