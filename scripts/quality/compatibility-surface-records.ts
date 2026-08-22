export interface CompatibilitySurfaceRecord {
  readonly symbol: string;
  readonly productionConsumers: readonly string[];
  readonly owner: string;
  readonly reason: string;
  readonly removeWhen: string;
}

export const compatibilitySurfaceRecords: readonly CompatibilitySurfaceRecord[] =
  [];
