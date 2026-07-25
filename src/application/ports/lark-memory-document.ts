export type BotDocument = {
  readonly token: string;
  readonly revision: string;
  readonly url: string;
};

export type MemoryDocumentComment = {
  readonly id: string;
  readonly text: string;
  readonly replies: readonly string[];
};
export type MemoryDocumentDraft = {
  readonly body: string;
  readonly revision: string;
  readonly unresolvedComments: readonly MemoryDocumentComment[];
};

export type MemoryDocumentPort = {
  create(input: {
    category: string;
    proposal: string;
    allowedOpenId: string;
  }): Promise<BotDocument>;
  readDraft(token: string): Promise<MemoryDocumentDraft>;
};
