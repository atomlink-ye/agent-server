import type { ProductState } from '../../contracts/product-projection/index.js';
import type {
  WorkChatWakeStateRepository,
  WorkChatWakeWorkKey,
} from '../../application/work-chat/work-chat-wake-state-repository.js';
import type { PostgresQueryable } from './postgres-conversation-repository.js';

type StateRow = { last_observed_state: string };

export class PostgresWorkChatWakeStateRepository implements WorkChatWakeStateRepository {
  public constructor(private readonly database: PostgresQueryable) {}

  public async getLastObserved(
    input: WorkChatWakeWorkKey,
  ): Promise<ProductState | null> {
    const result = await this.database.query<StateRow>(
      `SELECT last_observed_state
       FROM work_chat_wake_states
       WHERE tenant_id=$1 AND workspace_id=$2 AND work_id=$3`,
      [input.tenantId, input.workspaceId, input.workId],
    );
    const value = result.rows?.[0]?.last_observed_state;
    return value && isProductState(value) ? value : null;
  }

  public async saveObserved(
    input: WorkChatWakeWorkKey & {
      readonly state: ProductState;
      readonly observedAt: string;
    },
  ): Promise<void> {
    await this.database.query(
      `INSERT INTO work_chat_wake_states
         (tenant_id, workspace_id, work_id, last_observed_state, last_observed_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, workspace_id, work_id)
       DO UPDATE SET last_observed_state=$4, last_observed_at=$5`,
      [
        input.tenantId,
        input.workspaceId,
        input.workId,
        input.state,
        input.observedAt,
      ],
    );
  }
}

function isProductState(value: string): value is ProductState {
  return (
    value === 'running' ||
    value === 'needs_you' ||
    value === 'complete' ||
    value === 'problem' ||
    value === 'not_captured'
  );
}
