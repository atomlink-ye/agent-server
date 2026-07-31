'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  initialStreamProjection,
  parseRunStreamEvent,
  reduceRunStreamEvent,
} from '@/lib/stream-reducer';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  status: string;
  task_id: string;
  run_id: string | null;
};
type SessionResponse = { session: { session_id: string }; messages: Message[] };
type ViewStatus = 'loading' | 'idle' | 'running' | 'completed' | 'failed';
type RunTracking = {
  taskId: string;
  runId: string;
  formalAssistantSeen: boolean;
  terminal: 'succeeded' | 'failed' | 'cancelled' | null;
  sseDisconnected: boolean;
};

export default function HomePage() {
  const initializationRef = useRef<Promise<void> | null>(null);
  const [sessionId, setSessionId] = useState<string>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<ViewStatus>('loading');
  const [error, setError] = useState<string>();
  const [retryText, setRetryText] = useState('');
  const [activeTaskId, setActiveTaskId] = useState<string>();
  const [activeRunId, setActiveRunId] = useState<string>();
  const [transientAssistantText, setTransientAssistantText] =
    useState<string>();
  const retrySendRef = useRef<{ text: string; key: string } | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const runTrackingRef = useRef<RunTracking | null>(null);
  const runEpochRef = useRef(0);
  const activeTaskIdRef = useRef<string | undefined>(undefined);
  activeTaskIdRef.current = activeTaskId;

  const finishSuccessfulRun = useCallback(() => {
    runEpochRef.current += 1;
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    runTrackingRef.current = null;
    setActiveTaskId(undefined);
    setActiveRunId(undefined);
    setTransientAssistantText(undefined);
    setError(undefined);
    setStatus('completed');
  }, []);

  const finishFailedRun = useCallback(() => {
    runEpochRef.current += 1;
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    runTrackingRef.current = null;
    setActiveTaskId(undefined);
    setActiveRunId(undefined);
    setStatus('failed');
  }, []);

  const loadSession = useCallback(async () => {
    if (initializationRef.current) return initializationRef.current;
    const initialization = (async () => {
      const response = await fetch('/api/session', { cache: 'no-store' });
      if (!response.ok) throw new Error('session');
      const data = (await response.json()) as SessionResponse;
      setSessionId(data.session.session_id);
      setMessages(data.messages);
      const restored = restoreTask(data.messages);
      runEpochRef.current += 1;
      setStatus(restored.status);
      setActiveTaskId(restored.taskId);
      setActiveRunId(restored.runId);
      runTrackingRef.current =
        restored.taskId && restored.runId
          ? {
              taskId: restored.taskId,
              runId: restored.runId,
              formalAssistantSeen: false,
              terminal: null,
              sseDisconnected: false,
            }
          : null;
    })();
    initializationRef.current = initialization;
    await initialization;
  }, []);

  useEffect(() => {
    void loadSession().catch(() => {
      setError('聊天暂时不可用。');
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
      if (!effectCurrent || runEpochRef.current !== capturedEpoch) return false;
      if (activeTaskIdRef.current !== capturedTaskId) return false;
      const tracking = runTrackingRef.current;
      if (capturedRunId === undefined) return tracking === null;
      return (
        tracking?.taskId === capturedTaskId && tracking.runId === capturedRunId
      );
    };
    const timer = window.setInterval(() => {
      void refreshMessages(isCurrent)
        .then((next) => {
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
              if (tracking.terminal === 'succeeded') finishSuccessfulRun();
              else if (
                tracking.terminal === 'failed' ||
                tracking.terminal === 'cancelled'
              )
                finishFailedRun();
              else if (tracking.sseDisconnected) finishSuccessfulRun();
            } else if (!tracking && activeTaskIdRef.current === activeTaskId) {
              finishSuccessfulRun();
            }
          } else if (current && isFailedStatus(current.status)) {
            const tracking = runTrackingRef.current;
            if (!tracking || tracking.sseDisconnected) finishFailedRun();
          }
        })
        .catch(() => {
          if (!isCurrent()) return;
          setStatus('failed');
          setError('无法读取运行状态。');
        });
    }, 1000);
    return () => {
      effectCurrent = false;
      window.clearInterval(timer);
    };
  }, [
    activeTaskId,
    activeRunId,
    finishFailedRun,
    finishSuccessfulRun,
    refreshMessages,
    status,
  ]);

  useEffect(() => {
    if (status !== 'running' || !activeTaskId || !activeRunId) return;
    const source = new EventSource(
      `/api/runs/${encodeURIComponent(activeRunId)}/events`,
    );
    eventSourceRef.current?.close();
    eventSourceRef.current = source;
    let projection = initialStreamProjection;
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
      projection = reduceRunStreamEvent(projection, parsed);
      if (projection.assistantText !== null)
        setTransientAssistantText(projection.assistantText);
      if (projection.terminal) {
        tracking.terminal = projection.terminal;
        source.close();
        if (projection.terminal === 'succeeded') {
          if (tracking.formalAssistantSeen) finishSuccessfulRun();
        } else {
          setError('运行未能完成。');
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
        setError('实时更新已断开，仍在等待正式结果。');
      }
      source.close();
    };
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
      if (eventSourceRef.current === source) eventSourceRef.current = null;
    };
  }, [activeRunId, activeTaskId, finishFailedRun, finishSuccessfulRun, status]);

  async function sendMessage(overrideText?: string) {
    const messageText = (overrideText ?? text).trim();
    if (!sessionId || !messageText || status === 'running') return;
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
      setActiveTaskId(submitted.task_id);
      setActiveRunId(submitted.run_id ?? undefined);
      runTrackingRef.current = submitted.run_id
        ? {
            taskId: submitted.task_id,
            runId: submitted.run_id,
            formalAssistantSeen: false,
            terminal: null,
            sseDisconnected: false,
          }
        : null;
    } catch {
      setStatus('failed');
      setError('消息未能发送。');
      setText(messageText);
      setRetryText(messageText);
    }
  }

  return (
    <main className="page-shell">
      <section className="chat-frame" aria-label="Agent Server chat">
        <header className="chat-header">
          <div>
            <p className="eyebrow">Managed Agent</p>
            <h1>Managed Agent</h1>
          </div>
          <span className={`status ${status}`}>{statusLabel(status)}</span>
        </header>
        <div className="message-list">
          {messages.length === 0 ? (
            <div className="empty-state">发送一条消息，开始对话。</div>
          ) : (
            messages.map((message) => (
              <article
                className={`message ${message.role} ${message.status === 'failed' ? 'failed' : ''}`}
                key={message.id}
              >
                <p className="message-label">
                  {message.role === 'user' ? '你' : 'Agent'}
                </p>
                <p className="message-body">{message.text}</p>
              </article>
            ))
          )}
          {activeTaskId &&
            transientAssistantText !== undefined &&
            !messages.some(
              (message) =>
                message.role === 'assistant' &&
                message.task_id === activeTaskId,
            ) && (
              <article className="message assistant" aria-live="polite">
                <p className="message-label">Agent</p>
                <p className="message-body">{transientAssistantText}</p>
              </article>
            )}
        </div>
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            void sendMessage();
          }}
        >
          <div className="composer-row">
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="写下你的消息"
              disabled={status === 'loading' || status === 'running'}
              aria-label="消息"
            />
            <button
              type="submit"
              disabled={
                !text.trim() || status === 'loading' || status === 'running'
              }
            >
              发送
            </button>
          </div>
          <p className={`composer-note ${error ? 'error' : ''}`}>
            {error ?? (status === 'running' ? '正在处理你的消息。' : '')}
          </p>
          {error && retryText && (
            <button
              className="retry"
              type="button"
              onClick={() => {
                void sendMessage(retryText);
              }}
            >
              重试
            </button>
          )}
        </form>
      </section>
    </main>
  );
}

function restoreTask(next: Message[]): {
  status: ViewStatus;
  taskId: string | undefined;
  runId: string | undefined;
} {
  const latestUser = [...next]
    .reverse()
    .find((message) => message.role === 'user');
  if (!latestUser)
    return { status: 'idle', taskId: undefined, runId: undefined };
  if (isFailedStatus(latestUser.status)) {
    return { status: 'failed', taskId: undefined, runId: undefined };
  }
  const assistant = next.find(
    (message) =>
      message.role === 'assistant' && message.task_id === latestUser.task_id,
  );
  if (assistant) {
    return { status: 'completed', taskId: undefined, runId: undefined };
  }
  if (isPendingOrCompletedStatus(latestUser.status)) {
    return {
      status: 'running',
      taskId: latestUser.task_id,
      runId: latestUser.run_id ?? undefined,
    };
  }
  return { status: 'idle', taskId: undefined, runId: undefined };
}

function isFailedStatus(status: string) {
  return ['failed', 'cancelled', 'timed_out'].includes(status);
}

function isPendingOrCompletedStatus(status: string) {
  return ['queued', 'active', 'running', 'completed', 'succeeded'].includes(
    status,
  );
}

function statusLabel(status: ViewStatus) {
  return {
    loading: '连接中',
    idle: '可以发送',
    running: '运行中',
    completed: '已完成',
    failed: '失败',
  }[status];
}
