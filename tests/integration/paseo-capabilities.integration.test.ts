import { describe, expect, it } from 'vitest';

import { DaemonClient } from '@getpaseo/client';

describe('pinned Paseo client capabilities', () => {
  it('exposes the Runtime Session V2 methods required by later phases', () => {
    const prototype = DaemonClient.prototype as unknown as Record<
      string,
      unknown
    >;
    const requiredMethods = [
      'getConnectionState',
      'subscribeConnectionStatus',
      'on',
      'resumeAgent',
      'sendAgentMessage',
      'cancelAgent',
      'fetchAgent',
      'fetchAgentTimeline',
      'waitForFinish',
      'close',
    ] as const;

    for (const method of requiredMethods) {
      expect(prototype[method], method).toBeTypeOf('function');
    }
  });
});
