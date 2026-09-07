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

/** Encodes a selected WorkRun's result file. */
export function workRunResultFilePath(
  workId: string,
  workRunId: string,
  originConversationId: string | null = null,
): string {
  return workFilePath(
    workId,
    `runs/${workRunId}/result.md`,
    workRunId,
    originConversationId,
  );
}

/** Encodes a Work file selection and optional return context. */
export function workFilePath(
  workId: string,
  path: string,
  workRunId: string | null = null,
  originConversationId: string | null = null,
): string {
  const query = new URLSearchParams({
    scope: 'work',
    work_id: workId,
    path,
  });
  if (workRunId) query.set('run', workRunId);
  if (originConversationId)
    query.set('from_conversation', originConversationId);
  return `/files?${query.toString()}`;
}

export type WorkRunResultFileRoute = Readonly<{
  workId: string;
  path: string;
  workRunId: string | null;
  originConversationId: string | null;
}>;

/** Returns a Work file scope whenever its durable scope binding is present. */
export function parseWorkRunResultFileRoute(
  search: string,
): WorkRunResultFileRoute | null {
  const query = new URLSearchParams(search);
  const workId = query.get('work_id');
  const path = query.get('path');
  const workRunId = query.get('run');
  if (query.get('scope') !== 'work' || !workId || !path) return null;
  return {
    workId,
    path,
    workRunId,
    originConversationId: query.get('from_conversation'),
  };
}

export function parseSessionIndex(value: string | null): number | null {
  if (!value || !/^(?:0|[1-9]\d*)$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
