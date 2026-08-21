import type { ChatTurnProvider } from '../../application/ports/chat-turn-provider.js';

export class MockChatTurnProvider implements ChatTurnProvider {
  async runTurn(input: Parameters<ChatTurnProvider['runTurn']>[0]): Promise<{ readonly body: string; readonly provider: string }> {
    const last = input.messages[input.messages.length - 1];
    return {
      body: `[mock reply] Received: ${last?.body ?? '(no message)'}`,
      provider: 'mock',
    };
  }
}
