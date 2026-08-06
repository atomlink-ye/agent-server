import type { AgentProjectLock } from '../../domain/projects/agent-project-lock.js';

export interface AgentProjectLockStore {
  read(): Promise<AgentProjectLock | null>;
  write(
    lock: AgentProjectLock,
  ): Promise<{ outcome: 'Create' | 'Update' | 'NoOp'; fingerprint: string }>;
}
