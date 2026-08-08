declare module 'vitest/browser' {
  interface BrowserCommands {
    writeInventory(
      json: string,
      target?: 'chat-surface' | 'canary',
    ): Promise<{ path: string; bytes: number }>;
  }
}

export {};
