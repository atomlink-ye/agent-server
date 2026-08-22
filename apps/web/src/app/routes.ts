export function conversationPath(conversationId: string): string {
  return `/conversations/${encodeURIComponent(conversationId)}`;
}

export function workRootPath(
  originConversationId: string | null = null,
): string {
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

export function workTabPath(
  workId: string,
  tab: string,
  runId: string | null = null,
  originConversationId: string | null = null,
  sessionIndex: number | null = null,
): string {
  const query = new URLSearchParams();
  if (originConversationId)
    query.set('from_conversation', originConversationId);
  if (tab !== 'overview') query.set('tab', tab);
  if (runId) query.set('run', runId);
  if (sessionIndex !== null) query.set('session', String(sessionIndex));
  const suffix = query.toString();
  return `/work/${encodeURIComponent(workId)}${suffix ? `?${suffix}` : ''}`;
}

export function parseSessionIndex(value: string | null): number | null {
  if (!value || !/^(?:0|[1-9]\d*)$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
