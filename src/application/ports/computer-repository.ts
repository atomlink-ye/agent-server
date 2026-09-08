import type { Computer } from '../../domain/runtime/computer.js';

/** MVE slice: enough surface to exercise the `computers` table end to end. */
export interface ComputerRepository {
  create(computer: Computer): Promise<Computer>;
  findById(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly id: string;
  }): Promise<Computer | null>;
  listByWorkspace(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
  }): Promise<readonly Computer[]>;
}
