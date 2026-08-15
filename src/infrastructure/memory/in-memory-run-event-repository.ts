import { randomUUID } from 'node:crypto';
import { boundedRunEventPayload } from '../../application/ports/run-events.js';
import type {
  RunEvent,
  RunEventRepository,
  RunEventType,
  RuntimeSessionBinding,
} from '../../application/ports/run-events.js';
export class InMemoryRunEventRepository implements RunEventRepository {
  readonly #events = new Map<string, RunEvent[]>();
  readonly #bindings = new Map<string, RuntimeSessionBinding>();
  async bind(input: RuntimeSessionBinding) {
    const current = this.#bindings.get(input.runId);
    const sessionBinding =
      input.sessionBinding !== undefined
        ? input.sessionBinding
        : current?.sessionBinding;
    this.#bindings.set(input.runId, {
      ...current,
      ...input,
      ...(sessionBinding !== undefined ? { sessionBinding } : {}),
    });
  }
  async findLatestSessionBindingBySessionId(sessionId: string) {
    return (
      [...this.#bindings.values()]
        .filter(
          (binding) =>
            binding.sessionId === sessionId && binding.sessionBinding,
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
        ?.sessionBinding ?? null
    );
  }
  async getBinding(runId: string) {
    return this.#bindings.get(runId) ?? null;
  }
  async getSessionBindingForRunInSession(runId: string, sessionId: string) {
    const binding = this.#bindings.get(runId);
    return binding?.sessionId === sessionId && binding.sessionBinding
      ? binding.sessionBinding
      : null;
  }
  async append(
    runId: string,
    type: RunEventType,
    payload: RunEvent['payload'],
  ) {
    const events = this.#events.get(runId) ?? [];
    const existing = events.find(
      (event) =>
        event.type === type &&
        (type === 'succeeded' || type === 'failed' || type === 'cancelled'),
    );
    if (existing) return existing;
    const event: RunEvent = {
      id: randomUUID(),
      runId,
      sequence: events.length + 1,
      type,
      payload: boundedRunEventPayload(payload),
      createdAt: new Date().toISOString(),
    };
    events.push(event);
    this.#events.set(runId, events);
    return event;
  }
  async list(runId: string, after: number, limit = 100) {
    const all = this.#events.get(runId) ?? [];
    const events = all
      .filter((event) => event.sequence > after)
      .slice(0, limit);
    return {
      events,
      nextCursor: events.length === limit ? events.at(-1)!.sequence : null,
    };
  }
}
