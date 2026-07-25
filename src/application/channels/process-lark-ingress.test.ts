import { describe, expect, it, vi } from 'vitest';
import { ProcessLarkIngress } from './process-lark-ingress.js';

const base = (kind: 'message' | 'command' | 'card_action') =>
  ({
    id: kind,
    kind,
    externalMessageId: 'm',
    connectionKey: 'c',
    externalKey: 'm',
    chatId: 'chat',
    normalizationVersion: 'test',
    status: 'pending',
    attemptCount: 0,
    createdAt: '',
    updatedAt: '',
  }) as any;

describe('ProcessLarkIngress', () => {
  it('routes commands away from the message/Agent path', async () => {
    const message = { execute: vi.fn() };
    const command = { execute: vi.fn().mockResolvedValue({ accepted: true }) };
    await new ProcessLarkIngress(message, command, {
      execute: vi.fn(),
    }).execute(base('command'));
    expect(command.execute).toHaveBeenCalled();
    expect(message.execute).not.toHaveBeenCalled();
  });

  it('keeps ordinary messages on the existing path', async () => {
    const message = { execute: vi.fn().mockResolvedValue({ accepted: true }) };
    const command = { execute: vi.fn() };
    await new ProcessLarkIngress(message, command, {
      execute: vi.fn(),
    }).execute(base('message'));
    expect(message.execute).toHaveBeenCalled();
    expect(command.execute).not.toHaveBeenCalled();
  });

  it('routes card actions only to the control path', async () => {
    const message = { execute: vi.fn() };
    const command = { execute: vi.fn() };
    const control = { execute: vi.fn().mockResolvedValue({ accepted: true }) };
    await new ProcessLarkIngress(message, command, control).execute(
      base('card_action'),
    );
    expect(control.execute).toHaveBeenCalled();
    expect(message.execute).not.toHaveBeenCalled();
    expect(command.execute).not.toHaveBeenCalled();
  });

  it('E3 fails closed when Card control wiring is missing', async () => {
    expect(() =>
      new ProcessLarkIngress(
        { execute: vi.fn() },
        { execute: vi.fn() },
        undefined as any,
      ).execute(base('card_action')),
    ).toThrow();
  });
});
