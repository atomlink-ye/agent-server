export function conversationPath(conversationId: string): string {
  return `/conversations/${encodeURIComponent(conversationId)}`;
}

export function workRootPath(originConversationId: string | null = null): string {
  return originConversationId
    ? `/work?from_conversation=${encodeURIComponent(originConversationId)}`
    : '/work';
}

export function workPath(
  workId: string,
  originConversationId: string | null = null,
): string {
  const base = `/work/${encodeURIComponent(workId)}`;
  return originConversationId
    ? `${base}?from_conversation=${encodeURIComponent(originConversationId)}`
    : base;
}
