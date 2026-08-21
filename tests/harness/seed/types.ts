export interface SeedDatabase {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows?: readonly Row[]; readonly rowCount?: number | null }>;
}

export type HarnessOwner = Readonly<{
  tenantId: string;
  workspaceId: string;
  principalType: 'service_account';
  principalId: string;
}>;

export const HARNESS_NOW = '2026-08-21T00:00:00.000Z';
