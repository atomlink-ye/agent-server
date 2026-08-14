export interface ReadinessCheckResult {
  readonly name: string;
  readonly ready: boolean;
  readonly detail?: string;
}

export interface ReadinessProbe {
  check(): Promise<readonly ReadinessCheckResult[]>;
}

export interface ReadinessHealthSource {
  health(): Promise<{
    readonly checks: readonly ReadinessCheckResult[];
  }>;
}

export const noExternalDependencies: ReadinessProbe = {
  async check() {
    return [];
  },
};

/**
 * Readiness only needs dependency check results. Keeping this structural lets
 * tests inject small fakes without teaching the health layer about providers.
 */
export class RuntimeReadinessProbe implements ReadinessProbe {
  public constructor(private readonly source: ReadinessHealthSource) {}

  public async check(): Promise<readonly ReadinessCheckResult[]> {
    const health = await this.source.health();
    return health.checks;
  }
}
