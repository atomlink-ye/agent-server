'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityPanel } from '@/components/chat/activity-panel';
import { AssistantMarkdown } from '@/components/chat/assistant-markdown';
import {
  ConversationSidebar,
  type ChatSummary,
} from '@/components/chat/conversation-sidebar';
import { RunDetails, type ViewStatus } from '@/components/chat/run-details';
import {
  initialStreamProjection,
  parseRunStreamEvent,
  reduceRunStreamEvent,
  type StreamProjection,
} from '@/lib/stream-reducer';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  status: string;
  task_id: string;
  run_id: string | null;
  created_at?: string;
};
type ProductSession = {
  session_id: string;
  workspace_id: string;
  generation: number;
  status: string;
  environment_version_id: string;
};
type SessionResponse = { session: ProductSession; messages: Message[] };
type ReplayStatus = 'loading' | 'ready' | 'unavailable';
type RunTracking = {
  taskId: string;
  runId: string;
  formalAssistantSeen: boolean;
  terminal: 'succeeded' | 'failed' | 'cancelled' | null;
  sseDisconnected: boolean;
  durableCatchupInFlight: boolean;
};
type Turn = {
  taskId: string;
  runId: string | null;
  user?: Message;
  assistant?: Message;
};

export default function HomePage() {
  const initializationRef = useRef<Promise<void> | null>(null);
  const [sessionId, setSessionId] = useState<string>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<ViewStatus>('loading');
  const [error, setError] = useState<string>();
  const [retryText, setRetryText] = useState('');
  const [activeTaskId, setActiveTaskId] = useState<string>();
  const [activeRunId, setActiveRunId] = useState<string>();
  const [runDetails, setRunDetails] = useState<{
    taskId?: string;
    runId?: string;
  }>({});
  const [transientAssistantText, setTransientAssistantText] =
    useState<string>();
  const [projections, setProjections] = useState<
    Readonly<Record<string, StreamProjection>>
  >({});
  const [replayStatus, setReplayStatus] = useState<
    Readonly<Record<string, ReplayStatus>>
  >({});
  const [sseConnected, setSseConnected] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [navigationPending, setNavigationPending] = useState(false);
  const retrySendRef = useRef<{ text: string; key: string } | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const runTrackingRef = useRef<RunTracking | null>(null);
  const runEpochRef = useRef(0);
  const selectionEpochRef = useRef(0);
  const activeTaskIdRef = useRef<string | undefined>(undefined);
  const projectionsRef = useRef(projections);
  const navigationPendingRef = useRef(false);
  const navigationOperationRef = useRef(0);
  activeTaskIdRef.current = activeTaskId;
  projectionsRef.current = projections;

  const beginNavigation = useCallback(() => {
    if (navigationPendingRef.current) return null;
    const operation = navigationOperationRef.current + 1;
    navigationOperationRef.current = operation;
    navigationPendingRef.current = true;
    setNavigationPending(true);
    return operation;
  }, []);

  const finishNavigation = useCallback((operation: number) => {
    if (navigationOperationRef.current !== operation) return;
    navigationPendingRef.current = false;
    setNavigationPending(false);
  }, []);

  const refreshChats = useCallback(async () => {
    const response = await fetch('/api/chats', { cache: 'no-store' });
    if (!response.ok) throw new Error('chats');
    const data = (await response.json()) as { sessions: ChatSummary[] };
    setChats(data.sessions);
    return data.sessions;
  }, []);

  const finishSuccessfulRun = useCallback(() => {
    runEpochRef.current += 1;
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    runTrackingRef.current = null;
    setActiveTaskId(undefined);
    setActiveRunId(undefined);
    setTransientAssistantText(undefined);
    setError(undefined);
    setSseConnected(false);
    setStatus('completed');
    void refreshChats().catch(() => undefined);
  }, [refreshChats]);

  const finishFailedRun = useCallback(() => {
    runEpochRef.current += 1;
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    runTrackingRef.current = null;
    setActiveTaskId(undefined);
    setActiveRunId(undefined);
    setSseConnected(false);
    setStatus('failed');
    void refreshChats().catch(() => undefined);
  }, [refreshChats]);

  const buildReplayProjections = useCallback(
    async (
      selectedId: string,
      nextMessages: Message[],
      epoch: number,
    ): Promise<Readonly<Record<string, StreamProjection>>> => {
      const runIds = [
        ...new Set(
          nextMessages
            .map((message) => message.run_id)
            .filter((value): value is string => Boolean(value)),
        ),
      ];
      if (runIds.length === 0) return {};
      const results: Record<string, StreamProjection> = {};
      await Promise.all(
        runIds.map(async (runId) => {
          try {
            const response = await fetch(
              `/api/chats/${encodeURIComponent(selectedId)}/runs/${encodeURIComponent(runId)}/events`,
              { cache: 'no-store' },
            );
            if (!response.ok) throw new Error('events');
            const data = (await response.json()) as {
              events: Array<{
                sequence: number;
                type: string;
                payload?: unknown;
              }>;
            };
            const parsedEvents = data.events
              .map((event) => parseRunStreamEvent(JSON.stringify(event)))
              .filter(
                (event): event is NonNullable<typeof event> => event !== null,
              );
            let projection = initialStreamProjection;
            for (const event of parsedEvents)
              projection = reduceRunStreamEvent(projection, event);
            if (selectionEpochRef.current === epoch)
              results[runId] = projection;
          } catch {
            /* Replay unavailable — leave the projection empty for this run. */
          }
        }),
      );
      return results;
    },
    [],
  );

  const activateSession = useCallback(
    async (session: ProductSession, nextMessages: Message[]) => {
      const epoch = selectionEpochRef.current + 1;
      selectionEpochRef.current = epoch;
      runEpochRef.current += 1;
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      runTrackingRef.current = null;
      setSseConnected(false);
      const projections = await buildReplayProjections(
        session.session_id,
        nextMessages,
        epoch,
      );
      if (selectionEpochRef.current !== epoch) return;
      setSessionId(session.session_id);
      setMessages(nextMessages);
      setProjections(projections);
      setReplayStatus(
        Object.fromEntries(
          nextMessages
            .map((message) => message.run_id)
            .filter((value): value is string => Boolean(value))
            .map((runId) => [
              runId,
              projections[runId]
                ? ('ready' as const)
                : ('unavailable' as const),
            ]),
        ),
      );
      setTransientAssistantText(undefined);
      setError(undefined);
      setRetryText('');
      const restored = restoreTask(nextMessages);
      setRunDetails({ taskId: restored.taskId, runId: restored.runId });
      setStatus(restored.status);
      setActiveTaskId(
        restored.status === 'running' ? restored.taskId : undefined,
      );
      setActiveRunId(
        restored.status === 'running' ? restored.runId : undefined,
      );
      runTrackingRef.current =
        restored.status === 'running' && restored.taskId && restored.runId
          ? {
              taskId: restored.taskId,
              runId: restored.runId,
              formalAssistantSeen: false,
              terminal: null,
              sseDisconnected: false,
              durableCatchupInFlight: false,
            }
          : null;
      setMobileSidebarOpen(false);
    },
    [buildReplayProjections],
  );

  const loadSession = useCallback(async () => {
    if (initializationRef.current) return initializationRef.current;
    const initialization = (async () => {
      const operation = beginNavigation();
      if (operation === null) return;
      try {
        const sessionResponse = await fetch('/api/session', {
          cache: 'no-store',
        });
        if (!sessionResponse.ok) throw new Error('session');
        const data = (await sessionResponse.json()) as SessionResponse;
        const chatItems = await refreshChats();
        setChats(chatItems);
        await activateSession(data.session, data.messages);
      } finally {
        finishNavigation(operation);
      }
    })();
    initializationRef.current = initialization;
    await initialization;
  }, [activateSession, beginNavigation, finishNavigation, refreshChats]);

  useEffect(() => {
    void loadSession().catch(() => {
      setError('We couldn’t open this conversation.');
      setStatus('failed');
    });
  }, [loadSession]);

  const refreshMessages = useCallback(
    async (shouldCommit?: () => boolean) => {
      if (!sessionId) return [];
      const response = await fetch(`/api/sessions/${sessionId}/messages`, {
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('messages');
      const data = (await response.json()) as { messages: Message[] };
      if (shouldCommit && !shouldCommit()) return data.messages;
      setMessages(data.messages);
      return data.messages;
    },
    [sessionId],
  );

  useEffect(() => {
    if (status !== 'running' || !activeTaskId) return;
    let effectCurrent = true;
    const capturedTaskId = activeTaskId;
    const capturedRunId = activeRunId;
    const capturedEpoch = runEpochRef.current;
    const isCurrent = () => {
      if (
        !effectCurrent ||
        runEpochRef.current !== capturedEpoch ||
        activeTaskIdRef.current !== capturedTaskId
      )
        return false;
      const tracking = runTrackingRef.current;
      return capturedRunId === undefined
        ? tracking === null
        : tracking?.taskId === capturedTaskId &&
            tracking.runId === capturedRunId;
    };
    const completeAfterDurableCatchup = async (tracking: RunTracking) => {
      if (
        !tracking.sseDisconnected ||
        tracking.durableCatchupInFlight ||
        !capturedRunId ||
        !sessionId
      )
        return;
      tracking.durableCatchupInFlight = true;
      try {
        const results = await buildReplayProjections(
          sessionId,
          [
            {
              id: 'durable-catchup',
              role: 'assistant',
              text: '',
              status: 'completed',
              task_id: capturedTaskId,
              run_id: capturedRunId,
            },
          ],
          selectionEpochRef.current,
        );
        if (!isCurrent()) return;
        const replay = results[capturedRunId];
        if (!replay) return;
        setProjections((current) => ({
          ...current,
          [capturedRunId]: replay,
        }));
        setReplayStatus((current) => ({
          ...current,
          [capturedRunId]: 'ready',
        }));
        if (replay.assistantText !== null)
          setTransientAssistantText(replay.assistantText);
        finishSuccessfulRun();
      } finally {
        tracking.durableCatchupInFlight = false;
      }
    };
    const timer = window.setInterval(() => {
      void refreshMessages(isCurrent)
        .then(async (next) => {
          if (!isCurrent()) return;
          const current = next.find(
            (message) =>
              message.role === 'user' && message.task_id === capturedTaskId,
          );
          const assistant = next.find(
            (message) =>
              message.role === 'assistant' &&
              message.task_id === capturedTaskId,
          );
          if (assistant) {
            const tracking = runTrackingRef.current;
            if (tracking && tracking.taskId === capturedTaskId) {
              tracking.formalAssistantSeen = true;
              setTransientAssistantText(undefined);
              if (tracking.terminal === 'succeeded') {
                if (tracking.sseDisconnected)
                  await completeAfterDurableCatchup(tracking);
                else finishSuccessfulRun();
              } else if (
                tracking.terminal === 'failed' ||
                tracking.terminal === 'cancelled'
              )
                finishFailedRun();
              else if (tracking.sseDisconnected)
                await completeAfterDurableCatchup(tracking);
            }
          } else if (current && isFailedStatus(current.status)) {
            const tracking = runTrackingRef.current;
            if (!tracking || tracking.sseDisconnected) finishFailedRun();
          }
        })
        .catch(() => {
          if (!isCurrent()) return;
          setStatus('failed');
          setError('We couldn’t read the run status.');
        });
    }, 1000);
    return () => {
      effectCurrent = false;
      window.clearInterval(timer);
    };
  }, [
    activeRunId,
    activeTaskId,
    buildReplayProjections,
    finishFailedRun,
    finishSuccessfulRun,
    refreshMessages,
    sessionId,
    status,
  ]);

  useEffect(() => {
    if (status !== 'running' || !activeTaskId || !activeRunId) return;
    const source = new EventSource(
      `/api/runs/${encodeURIComponent(activeRunId)}/events`,
    );
    eventSourceRef.current?.close();
    eventSourceRef.current = source;
    setSseConnected(false);
    let nextProjection =
      projectionsRef.current[activeRunId] ?? initialStreamProjection;
    const isCurrentSource = () => {
      const tracking = runTrackingRef.current;
      return (
        tracking?.taskId === activeTaskId &&
        tracking.runId === activeRunId &&
        !tracking.terminal &&
        eventSourceRef.current === source
      );
    };
    const onOpen = () => {
      if (isCurrentSource()) setSseConnected(true);
    };
    const onEvent = (event: Event) => {
      const tracking = runTrackingRef.current;
      if (
        !tracking ||
        tracking.taskId !== activeTaskId ||
        tracking.runId !== activeRunId ||
        eventSourceRef.current !== source
      )
        return;
      const data = event instanceof MessageEvent ? event.data : undefined;
      if (typeof data !== 'string') return;
      const parsed = parseRunStreamEvent(data);
      if (!parsed) return;
      nextProjection = reduceRunStreamEvent(nextProjection, parsed);
      setProjections((current) => ({
        ...current,
        [activeRunId]: nextProjection,
      }));
      setReplayStatus((current) => ({ ...current, [activeRunId]: 'ready' }));
      if (nextProjection.assistantText !== null)
        setTransientAssistantText(nextProjection.assistantText);
      if (nextProjection.terminal) {
        tracking.terminal = nextProjection.terminal;
        source.close();
        setSseConnected(false);
        if (nextProjection.terminal === 'succeeded') {
          if (tracking.formalAssistantSeen) finishSuccessfulRun();
        } else {
          setError('The Agent couldn’t complete this request.');
          finishFailedRun();
        }
      }
    };
    const onError = () => {
      const tracking = runTrackingRef.current;
      if (
        !tracking ||
        tracking.taskId !== activeTaskId ||
        tracking.runId !== activeRunId ||
        eventSourceRef.current !== source
      )
        return;
      if (!tracking.terminal) {
        tracking.sseDisconnected = true;
        setError(
          'Live updates disconnected. We’re checking for the saved response.',
        );
      }
      setSseConnected(false);
    };
    source.addEventListener('open', onOpen);
    for (const name of [
      'started',
      'output',
      'succeeded',
      'failed',
      'cancelled',
    ])
      source.addEventListener(name, onEvent);
    source.addEventListener('message', onEvent);
    source.addEventListener('error', onError);
    return () => {
      source.close();
      if (eventSourceRef.current === source) {
        eventSourceRef.current = null;
        setSseConnected(false);
      }
    };
  }, [activeRunId, activeTaskId, finishFailedRun, finishSuccessfulRun, status]);

  async function selectChat(nextSessionId: string) {
    if (
      status === 'running' ||
      navigationPendingRef.current ||
      nextSessionId === sessionId
    ) {
      setMobileSidebarOpen(false);
      return;
    }
    const operation = beginNavigation();
    if (operation === null) return;
    setError(undefined);
    try {
      const response = await fetch(
        `/api/chats/${encodeURIComponent(nextSessionId)}/select`,
        { method: 'POST' },
      );
      if (!response.ok) throw new Error('select');
      const data = (await response.json()) as SessionResponse;
      await activateSession(data.session, data.messages);
    } catch {
      setError('That conversation could not be opened.');
    } finally {
      finishNavigation(operation);
    }
  }

  async function createChat() {
    if (status === 'running' || navigationPendingRef.current) return;
    const operation = beginNavigation();
    if (operation === null) return;
    setError(undefined);
    try {
      const response = await fetch('/api/chats', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (!response.ok) throw new Error('new chat');
      const data = (await response.json()) as SessionResponse;
      await activateSession(data.session, data.messages);
      setChats((current) => [
        {
          session_id: data.session.session_id,
          title: 'New chat',
          preview: null,
          preview_role: null,
          last_message_at: null,
          created_at: new Date().toISOString(),
          status: 'Ready',
        },
        ...current.filter(
          (chat) => chat.session_id !== data.session.session_id,
        ),
      ]);
      try {
        await refreshChats();
      } catch {
        setError(
          'New chat started, but the conversation list could not refresh.',
        );
      }
    } catch {
      setError(
        'Couldn’t start a new chat. Your current conversation is unchanged.',
      );
    } finally {
      finishNavigation(operation);
    }
  }

  async function sendMessage(overrideText?: string) {
    const messageText = (overrideText ?? text).trim();
    if (
      !sessionId ||
      !messageText ||
      status === 'running' ||
      navigationPendingRef.current
    )
      return;
    setError(undefined);
    setRetryText('');
    setTransientAssistantText(undefined);
    const pending = retrySendRef.current;
    const idempotencyKey =
      pending?.text === messageText ? pending.key : crypto.randomUUID();
    retrySendRef.current = { text: messageText, key: idempotencyKey };
    runEpochRef.current += 1;
    setText('');
    setStatus('running');
    try {
      const response = await fetch(`/api/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({ text: messageText }),
      });
      if (!response.ok) throw new Error('send');
      const submitted = (await response.json()) as Message;
      retrySendRef.current = null;
      setMessages((current) => [...current, submitted]);
      setRunDetails({
        taskId: submitted.task_id,
        runId: submitted.run_id ?? undefined,
      });
      setActiveTaskId(submitted.task_id);
      setActiveRunId(submitted.run_id ?? undefined);
      runTrackingRef.current = submitted.run_id
        ? {
            taskId: submitted.task_id,
            runId: submitted.run_id,
            formalAssistantSeen: false,
            terminal: null,
            sseDisconnected: false,
            durableCatchupInFlight: false,
          }
        : null;
    } catch {
      setStatus('failed');
      setError('Message not sent. Your text is still here.');
      setText(messageText);
      setRetryText(messageText);
    }
  }

  const turns = groupTurns(messages);
  const selectedChatStatus =
    status === 'running'
      ? 'Working'
      : status === 'failed'
        ? 'Failed'
        : status === 'completed'
          ? 'Completed'
          : undefined;
  const sidebarChats = chats.map((chat) =>
    chat.session_id === sessionId && selectedChatStatus
      ? {
          ...chat,
          preview_role:
            selectedChatStatus === 'Completed'
              ? ('assistant' as const)
              : selectedChatStatus === 'Working'
                ? ('user' as const)
                : chat.preview_role,
        }
      : chat,
  );

  return (
    <main className="page-shell">
      <section className="chat-frame" aria-label="Agent Server Web Chat">
        <ConversationSidebar
          chats={sidebarChats}
          selectedSessionId={sessionId}
          disabled={status === 'running' || navigationPending}
          mobileOpen={mobileSidebarOpen}
          onNewChat={() => void createChat()}
          onSelect={(id) => void selectChat(id)}
          onCloseMobile={() => setMobileSidebarOpen(false)}
        />
        <section className="chat-main">
          <header className="chat-header">
            <button
              className="mobile-menu-button"
              type="button"
              aria-label="Open conversations"
              aria-expanded={mobileSidebarOpen}
              onClick={() => setMobileSidebarOpen(true)}
            >
              ☰
            </button>
            <div className="brand-lockup">
              <span className="brand-mark" aria-hidden="true">
                A
              </span>
              <div>
                <p className="eyebrow">Selected ProductSession</p>
                <h1>Research Desk</h1>
              </div>
            </div>
            <div className="header-state">
              <span className={`status ${status}`} aria-live="polite">
                {statusLabel(status)}
              </span>
              <span className="state-detail">
                Same Agent · same runtime context
              </span>
            </div>
            <details className="run-details-disclosure">
              <summary>Details</summary>
              <RunDetails
                projection={
                  activeRunId
                    ? (projections[activeRunId] ?? initialStreamProjection)
                    : initialStreamProjection
                }
                status={status}
                sessionId={sessionId}
                taskId={runDetails.taskId}
                runId={runDetails.runId}
                connected={sseConnected}
              />
            </details>
          </header>
          <div className="chat-layout">
            <section className="conversation-column">
              <div
                className="message-list"
                aria-live={activeRunId ? 'polite' : undefined}
              >
                {!messages.length && status !== 'loading' ? (
                  <EmptyState onPrompt={setText} />
                ) : null}
                {status === 'loading' ? <LoadingState /> : null}
                {turns.map((turn) => (
                  <TurnView
                    key={turn.taskId}
                    turn={turn}
                    activeRunId={activeRunId}
                    projections={projections}
                    replayStatus={replayStatus}
                    transientAssistantText={
                      turn.taskId === activeTaskId
                        ? transientAssistantText
                        : undefined
                    }
                  />
                ))}
                {error && status !== 'running' ? (
                  <ErrorState
                    message={error}
                    retryText={retryText}
                    onRetry={() => void sendMessage(retryText)}
                  />
                ) : null}
              </div>
              <Composer
                text={text}
                setText={setText}
                status={status}
                pending={navigationPending}
                error={error}
                onSend={() => void sendMessage()}
                onRetry={() => void sendMessage(retryText)}
                hasRetry={Boolean(error && retryText)}
              />
            </section>
          </div>
        </section>
      </section>
    </main>
  );
}

function TurnView({
  turn,
  activeRunId,
  projections,
  replayStatus,
  transientAssistantText,
}: {
  readonly turn: Turn;
  readonly activeRunId?: string;
  readonly projections: Readonly<Record<string, StreamProjection>>;
  readonly replayStatus: Readonly<Record<string, ReplayStatus>>;
  readonly transientAssistantText?: string;
}) {
  const runId = turn.runId;
  const projection = runId
    ? (projections[runId] ?? initialStreamProjection)
    : initialStreamProjection;
  const active = Boolean(runId && runId === activeRunId);
  const isFormalAssistant = Boolean(turn.assistant);
  return (
    <div className="turn">
      <MessageView message={turn.user} />
      {runId ? (
        <ActivityPanel
          projection={projection}
          active={active}
          replayAvailable={replayStatus[runId] !== 'unavailable'}
          replayLoading={active || replayStatus[runId] === 'loading'}
        />
      ) : null}
      {turn.assistant ? <MessageView message={turn.assistant} /> : null}
      {transientAssistantText !== undefined && !isFormalAssistant ? (
        <article className="message assistant transient-message">
          <p className="message-label">
            Research Desk <span>· live response</span>
          </p>
          <div className="assistant-surface">
            <AssistantMarkdown text={transientAssistantText} />
          </div>
        </article>
      ) : null}
    </div>
  );
}

function groupTurns(messages: Message[]): Turn[] {
  const turns: Turn[] = [];
  const byTask = new Map<string, Turn>();
  for (const message of messages) {
    let turn = byTask.get(message.task_id);
    if (!turn) {
      turn = { taskId: message.task_id, runId: message.run_id };
      byTask.set(message.task_id, turn);
      turns.push(turn);
    }
    if (message.run_id) turn.runId = message.run_id;
    if (message.role === 'user') turn.user = message;
    else turn.assistant = message;
  }
  return turns;
}

function MessageView({ message }: { readonly message?: Message }) {
  if (!message) return null;
  const failed = message.status === 'failed';
  return (
    <article className={`message ${message.role} ${failed ? 'failed' : ''}`}>
      <p className="message-label">
        {message.role === 'user' ? 'You' : 'Research Desk'}
      </p>
      <div className="message-surface">
        {message.role === 'assistant' ? (
          <AssistantMarkdown text={message.text} />
        ) : (
          <p className="plain-message">{message.text}</p>
        )}
      </div>
      {message.role === 'assistant' && !failed ? (
        <p className="message-meta">Saved response</p>
      ) : null}
    </article>
  );
}
function EmptyState({
  onPrompt,
}: {
  readonly onPrompt: (prompt: string) => void;
}) {
  return (
    <div className="empty-state">
      <div className="empty-orb" aria-hidden="true">
        ✦
      </div>
      <h2>Start with a brief</h2>
      <p>
        Ask the managed Agent to explain, research, compare, or draft something.
      </p>
      <button
        type="button"
        onClick={() =>
          onPrompt(
            'Summarize the current project direction and next decisions.',
          )
        }
      >
        Try an example prompt <span>↗</span>
      </button>
    </div>
  );
}
function LoadingState() {
  return (
    <div className="loading-state" role="status">
      <span className="loading-spinner" aria-hidden="true" />
      Loading your conversation…
    </div>
  );
}
function ErrorState({
  message,
  retryText,
  onRetry,
}: {
  readonly message: string;
  readonly retryText: string;
  readonly onRetry: () => void;
}) {
  return (
    <div className="error-state" role="alert">
      <strong>{message}</strong>
      {retryText ? (
        <button type="button" onClick={onRetry}>
          Retry sending
        </button>
      ) : null}
    </div>
  );
}
function Composer({
  text,
  setText,
  status,
  pending,
  error,
  onSend,
  onRetry,
  hasRetry,
}: {
  readonly text: string;
  readonly setText: (value: string) => void;
  readonly status: ViewStatus;
  readonly pending: boolean;
  readonly error?: string;
  readonly onSend: () => void;
  readonly onRetry: () => void;
  readonly hasRetry: boolean;
}) {
  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        onSend();
      }}
    >
      <div className="composer-row">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              onSend();
            }
          }}
          placeholder="Ask the managed Agent…"
          disabled={pending || status === 'loading' || status === 'running'}
          aria-label="Message"
          rows={1}
        />
        <button
          type="submit"
          disabled={
            pending ||
            !text.trim() ||
            status === 'loading' ||
            status === 'running'
          }
        >
          Send <span aria-hidden="true">↗</span>
        </button>
      </div>
      <div className={`composer-footer ${error ? 'has-error' : ''}`}>
        <span>
          {error ?? 'Markdown supported · Shift + Enter for a new line'}
        </span>
        {hasRetry ? (
          <button type="button" className="inline-retry" onClick={onRetry}>
            Retry
          </button>
        ) : null}
      </div>
    </form>
  );
}
function restoreTask(next: Message[]): {
  status: ViewStatus;
  taskId?: string;
  runId?: string;
} {
  const latestUser = [...next]
    .reverse()
    .find((message) => message.role === 'user');
  if (!latestUser) return { status: 'idle' };
  if (isFailedStatus(latestUser.status))
    return {
      status: 'failed',
      taskId: latestUser.task_id,
      runId: latestUser.run_id ?? undefined,
    };
  const assistant = next.find(
    (message) =>
      message.role === 'assistant' && message.task_id === latestUser.task_id,
  );
  if (assistant)
    return {
      status: 'completed',
      taskId: latestUser.task_id,
      runId: latestUser.run_id ?? undefined,
    };
  if (isPendingStatus(latestUser.status))
    return {
      status: 'running',
      taskId: latestUser.task_id,
      runId: latestUser.run_id ?? undefined,
    };
  return {
    status: 'idle',
    taskId: latestUser.task_id,
    runId: latestUser.run_id ?? undefined,
  };
}
function isFailedStatus(value: string) {
  return ['failed', 'cancelled', 'timed_out'].includes(value);
}
function isPendingStatus(value: string) {
  return ['queued', 'active', 'running', 'completed', 'succeeded'].includes(
    value,
  );
}
function statusLabel(value: ViewStatus) {
  return {
    loading: 'Connecting',
    idle: 'Ready',
    running: 'Working',
    completed: 'Completed',
    failed: 'Couldn’t complete',
  }[value];
}
