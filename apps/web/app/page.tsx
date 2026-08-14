'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChatSurface,
  type Message,
  type ReplayStatus,
  type TeamSessionResponse,
} from '@/components/chat/chat-surface';
import {
  ConversationSidebar,
  type ChatSummary,
  type TeamProject,
  type TeamSession,
} from '@/components/chat/conversation-sidebar';
import { RunDetails, type ViewStatus } from '@/components/chat/run-details';
import { selectCapabilities } from '@/lib/capabilities';
import type { SafeRunEvent } from '@/lib/safe-run-events';
import {
  applyTimelineEnvelopes,
  initialTimelineState,
  parseRunStreamEvent,
  selectTerminalLifecycle,
  type TimelineEnvelope,
  type TimelineState,
} from '@/lib/stream-reducer';

type ProductSession = {
  session_id: string;
  workspace_id: string;
  generation: number;
  status: string;
  environment_version_id: string;
};
type SessionResponse = { session: ProductSession; messages: Message[] };
type ChatSelection =
  | { kind: 'product_session'; sessionId: string }
  | { kind: 'team_overview'; rootTaskId: string; teamRunId: string }
  | {
      kind: 'team_agent_session';
      rootTaskId: string;
      teamRunId: string;
      memberRunId: string;
    };
type ReplayTimelines = {
  readonly envelopes: Readonly<Record<string, readonly TimelineEnvelope[]>>;
  readonly statuses: Readonly<Record<string, ReplayStatus>>;
};
type RunTracking = {
  taskId: string;
  runId: string;
  formalAssistantSeen: boolean;
  canonicalAssistant: Message | null;
  terminal: 'succeeded' | 'failed' | 'cancelled' | null;
  sseDisconnected: boolean;
  durableCatchupInFlight: boolean;
};

const TEAM_ROOT_TASK_PARAM = 'rootTaskId';
const TEAM_MEMBER_RUN_PARAM = 'memberRunId';

function readTeamUrlSelection():
  { rootTaskId: string; memberRunId?: string } | undefined {
  if (typeof window === 'undefined') return undefined;
  const params = new URLSearchParams(window.location.search);
  const rootTaskId = params.get(TEAM_ROOT_TASK_PARAM);
  const memberRunId = params.get(TEAM_MEMBER_RUN_PARAM);
  if (!rootTaskId && !memberRunId) return undefined;
  if (!isUuid(rootTaskId) || (memberRunId !== null && !isUuid(memberRunId)))
    return undefined;
  return memberRunId ? { rootTaskId, memberRunId } : { rootTaskId };
}

function hasTeamUrlSelection(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.has(TEAM_ROOT_TASK_PARAM) || params.has(TEAM_MEMBER_RUN_PARAM);
}

function isUuid(value: string | null): value is string {
  return (
    value !== null &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

export default function HomePage() {
  const initializationRef = useRef<Promise<void> | null>(null);
  const [sessionId, setSessionId] = useState<string>();
  const [selection, setSelection] = useState<ChatSelection>();
  const [teamProject, setTeamProject] = useState<TeamProject>();
  const [teamSession, setTeamSession] = useState<TeamSessionResponse>();
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
  const [timeline, setTimeline] = useState<TimelineState>(initialTimelineState);
  const [replayStatus, setReplayStatus] = useState<
    Readonly<Record<string, ReplayStatus>>
  >({});
  const [sseConnected, setSseConnected] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [navigationPending, setNavigationPending] = useState(false);
  const [now, setNow] = useState<string | null>(null);
  const retrySendRef = useRef<{ text: string; key: string } | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const runTrackingRef = useRef<RunTracking | null>(null);
  const runEpochRef = useRef(0);
  const selectionEpochRef = useRef(0);
  const activeTaskIdRef = useRef<string | undefined>(undefined);
  const timelineRef = useRef(timeline);
  const navigationPendingRef = useRef(false);
  const navigationOperationRef = useRef(0);
  const selectTeamSessionRef = useRef<
    | ((
        session: TeamSession,
        existingOperation?: number,
        projectOverride?: TeamProject,
      ) => Promise<void>)
    | undefined
  >(undefined);
  activeTaskIdRef.current = activeTaskId;

  useEffect(() => {
    const tick = () => setNow(new Date().toISOString());
    tick();
    const interval = window.setInterval(tick, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const commitTimeline = useCallback((next: TimelineState) => {
    timelineRef.current = next;
    setTimeline(next);
    return next;
  }, []);

  const commitTimelineEnvelopes = useCallback(
    (envelopes: readonly TimelineEnvelope[]) => {
      const next = applyTimelineEnvelopes(timelineRef.current, envelopes);
      return commitTimeline(next);
    },
    [commitTimeline],
  );

  const applyRunEvent = useCallback(
    (runId: string, data: unknown) => {
      if (typeof data !== 'string') return undefined;
      const parsed = parseRunStreamEvent(data);
      if (!parsed) return undefined;
      const next = commitTimelineEnvelopes([
        { runId, update: { kind: 'runEvent', event: parsed } },
      ]);
      setReplayStatus((current) => ({ ...current, [runId]: 'ready' }));
      return selectTerminalLifecycle(next, runId);
    },
    [commitTimelineEnvelopes],
  );

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

  const refreshTeamProject = useCallback(async () => {
    try {
      const response = await fetch('/api/team-project', { cache: 'no-store' });
      if (!response.ok) return undefined;
      const data = (await response.json()) as TeamProject | null;
      setTeamProject(data ?? undefined);
      return data ?? undefined;
    } catch {
      // Project discovery is optional; the existing Chats list remains primary.
      return undefined;
    }
  }, []);

  const updateTeamUrl = useCallback(
    (rootTaskId: string, memberRunId?: string) => {
      const url = new URL(window.location.href);
      url.searchParams.set(TEAM_ROOT_TASK_PARAM, rootTaskId);
      if (memberRunId) url.searchParams.set(TEAM_MEMBER_RUN_PARAM, memberRunId);
      else url.searchParams.delete(TEAM_MEMBER_RUN_PARAM);
      window.history.replaceState(
        {},
        '',
        `${url.pathname}${url.search}${url.hash}`,
      );
    },
    [],
  );

  const clearTeamUrl = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete(TEAM_ROOT_TASK_PARAM);
    url.searchParams.delete(TEAM_MEMBER_RUN_PARAM);
    window.history.replaceState(
      {},
      '',
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, []);

  const finishSuccessfulRun = useCallback(() => {
    runEpochRef.current += 1;
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    runTrackingRef.current = null;
    setActiveTaskId(undefined);
    setActiveRunId(undefined);
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

  const buildReplayTimelines = useCallback(
    async (
      selectedId: string,
      nextMessages: Message[],
      epoch: number,
    ): Promise<ReplayTimelines> => {
      const runIds = [
        ...new Set(
          nextMessages
            .map((message) => message.run_id)
            .filter((value): value is string => Boolean(value)),
        ),
      ];
      if (runIds.length === 0) return { envelopes: {}, statuses: {} };
      const results: Record<string, readonly TimelineEnvelope[]> = {};
      const statuses: Record<string, ReplayStatus> = {};
      await Promise.all(
        runIds.map(async (runId) => {
          const user = nextMessages.find(
            (message) => message.run_id === runId && message.role === 'user',
          );
          const assistant = nextMessages.find(
            (message) =>
              message.run_id === runId && message.role === 'assistant',
          );
          let parsedEvents: NonNullable<
            ReturnType<typeof parseRunStreamEvent>
          >[] = [];
          let replayAvailable = true;
          try {
            const response = await fetch(
              `/api/chats/${encodeURIComponent(selectedId)}/runs/${encodeURIComponent(runId)}/events`,
              { cache: 'no-store' },
            );
            if (!response.ok) throw new Error('events');
            const data = (await response.json()) as {
              events: SafeRunEvent[];
            };
            parsedEvents = data.events
              .map((event) => parseRunStreamEvent(JSON.stringify(event)))
              .filter(
                (event): event is NonNullable<typeof event> => event !== null,
              );
            replayAvailable = true;
          } catch {
            replayAvailable = false;
          }
          const envelopes: TimelineEnvelope[] = [];
          if (user)
            envelopes.push({
              runId,
              update: { kind: 'prompt', text: user.text, messageId: user.id },
            });
          envelopes.push(
            ...parsedEvents.map((event) => ({
              runId,
              update: { kind: 'runEvent' as const, event },
            })),
          );
          if (assistant)
            envelopes.push({
              runId,
              update: {
                kind: 'canonicalAgentText',
                text: assistant.text,
                messageId: assistant.id,
              },
            });
          if (selectionEpochRef.current === epoch) results[runId] = envelopes;
          statuses[runId] = replayAvailable ? 'ready' : 'unavailable';
        }),
      );
      return { envelopes: results, statuses };
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
      const replay = await buildReplayTimelines(
        session.session_id,
        nextMessages,
        epoch,
      );
      if (selectionEpochRef.current !== epoch) return;
      clearTeamUrl();
      setSessionId(session.session_id);
      setSelection({ kind: 'product_session', sessionId: session.session_id });
      setTeamSession(undefined);
      setMessages(nextMessages);
      const hydrated = applyTimelineEnvelopes(
        initialTimelineState,
        Object.values(replay.envelopes).flat(),
      );
      commitTimeline(hydrated);
      setReplayStatus(
        Object.fromEntries(
          nextMessages
            .map((message) => message.run_id)
            .filter((value): value is string => Boolean(value))
            .map((runId) => [
              runId,
              replay.statuses[runId] ?? ('unavailable' as const),
            ]),
        ),
      );
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
              canonicalAssistant: null,
              terminal: null,
              sseDisconnected: false,
              durableCatchupInFlight: false,
            }
          : null;
      setMobileSidebarOpen(false);
    },
    [buildReplayTimelines, clearTeamUrl, commitTimeline],
  );

  const loadSession = useCallback(async () => {
    if (initializationRef.current) return initializationRef.current;
    const initialization = (async () => {
      const operation = beginNavigation();
      if (operation === null) return;
      try {
        const requestedTeam = readTeamUrlSelection();
        const hasTeamUrl = hasTeamUrlSelection();
        const [sessionResponse, chatItems, project] = await Promise.all([
          requestedTeam
            ? Promise.resolve(null)
            : fetch('/api/session', { cache: 'no-store' }),
          refreshChats(),
          refreshTeamProject(),
        ]);
        setChats(chatItems);
        if (
          requestedTeam &&
          project?.root_task_id === requestedTeam.rootTaskId
        ) {
          if (!requestedTeam.memberRunId) {
            await selectTeamOverview(project, operation);
            return;
          }
          const teamSession = project.sessions.find(
            (session) => session.agent_session_id === requestedTeam.memberRunId,
          );
          if (teamSession) {
            await selectTeamSessionRef.current?.(
              teamSession,
              operation,
              project,
            );
            return;
          }
        }
        if (requestedTeam) return;
        if (hasTeamUrl) clearTeamUrl();
        if (!sessionResponse || !sessionResponse.ok) throw new Error('session');
        const data = (await sessionResponse.json()) as SessionResponse;
        await activateSession(data.session, data.messages);
      } finally {
        finishNavigation(operation);
      }
    })();
    initializationRef.current = initialization;
    await initialization;
  }, [
    activateSession,
    beginNavigation,
    clearTeamUrl,
    finishNavigation,
    refreshChats,
    refreshTeamProject,
  ]);

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
        !sessionId ||
        !tracking.canonicalAssistant
      )
        return;
      tracking.durableCatchupInFlight = true;
      try {
        const assistant = tracking.canonicalAssistant;
        const results = await buildReplayTimelines(
          sessionId,
          [
            {
              id: assistant.id,
              role: 'assistant',
              text: assistant.text,
              status: 'completed',
              task_id: capturedTaskId,
              run_id: capturedRunId,
            },
          ],
          selectionEpochRef.current,
        );
        if (!isCurrent()) return;
        const envelopes = results.envelopes[capturedRunId] ?? [];
        commitTimelineEnvelopes(envelopes);
        setReplayStatus((current) => ({
          ...current,
          [capturedRunId]: results.statuses[capturedRunId] ?? 'unavailable',
        }));
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
              tracking.canonicalAssistant = assistant;
              if (tracking.terminal === 'succeeded') {
                if (tracking.sseDisconnected)
                  await completeAfterDurableCatchup(tracking);
                else if (tracking.canonicalAssistant) {
                  commitTimelineEnvelopes([
                    {
                      runId: capturedRunId!,
                      update: {
                        kind: 'canonicalAgentText',
                        text: tracking.canonicalAssistant.text,
                        messageId: tracking.canonicalAssistant.id,
                      },
                    },
                  ]);
                  finishSuccessfulRun();
                }
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
    buildReplayTimelines,
    commitTimelineEnvelopes,
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
      const terminal = applyRunEvent(activeRunId, data);
      if (!terminal) return;
      tracking.terminal = terminal.status;
      source.close();
      setSseConnected(false);
      if (terminal.status === 'succeeded') {
        if (tracking.formalAssistantSeen && tracking.canonicalAssistant) {
          commitTimelineEnvelopes([
            {
              runId: activeRunId,
              update: {
                kind: 'canonicalAgentText',
                text: tracking.canonicalAssistant.text,
                messageId: tracking.canonicalAssistant.id,
              },
            },
          ]);
          finishSuccessfulRun();
        }
      } else {
        setError('The Agent couldn’t complete this request.');
        finishFailedRun();
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
  }, [
    activeRunId,
    activeTaskId,
    applyRunEvent,
    commitTimelineEnvelopes,
    finishFailedRun,
    finishSuccessfulRun,
    status,
  ]);

  useEffect(() => {
    if (
      selection?.kind !== 'team_agent_session' ||
      !teamSession ||
      status !== 'running'
    )
      return;
    const capturedSelectionEpoch = selectionEpochRef.current;
    const turn = teamSession.turns.find((item) => item.status === 'running');
    if (!turn) return;
    const source = new EventSource(
      `/api/team-project/runs/${encodeURIComponent(turn.run_id)}/events?task=${encodeURIComponent(selection.rootTaskId)}`,
    );
    eventSourceRef.current?.close();
    eventSourceRef.current = source;
    let terminalHandled = false;
    const isCurrentSelectionEpoch = () =>
      selectionEpochRef.current === capturedSelectionEpoch;
    const onEvent = (event: Event) => {
      if (!isCurrentSelectionEpoch() || eventSourceRef.current !== source)
        return;
      if (terminalHandled) return;
      const data = event instanceof MessageEvent ? event.data : undefined;
      const terminal = applyRunEvent(turn.run_id, data);
      if (!terminal) return;
      const terminalFailed =
        terminal.status === 'failed' || terminal.status === 'cancelled';
      terminalHandled = true;
      source.close();
      setStatus(terminalFailed ? 'failed' : 'completed');
      void (async () => {
        try {
          const response = await fetch(
            `/api/team-project/sessions/${encodeURIComponent(selection.memberRunId)}?task=${encodeURIComponent(selection.rootTaskId)}`,
            { cache: 'no-store' },
          );
          if (!response.ok || !isCurrentSelectionEpoch()) return;
          const refreshed = (await response.json()) as TeamSessionResponse;
          if (!isCurrentSelectionEpoch()) return;
          const refreshedTurn = refreshed.turns.find(
            (item) => item.run_id === turn.run_id,
          );
          if (refreshedTurn?.result_summary) {
            if (!isCurrentSelectionEpoch()) return;
            commitTimelineEnvelopes([
              {
                runId: turn.run_id,
                update: {
                  kind: 'canonicalAgentText',
                  text: refreshedTurn.result_summary,
                },
              },
            ]);
          }
          if (!isCurrentSelectionEpoch()) return;
          setTeamSession(refreshed);
          if (!isCurrentSelectionEpoch()) return;
          const hasRunningTurn = refreshed.turns.some(
            (item) => item.status === 'running',
          );
          const hasFailedTurn =
            terminalFailed ||
            refreshed.turns.some((item) => item.status === 'failed');
          setStatus(
            hasRunningTurn ? 'running' : hasFailedTurn ? 'failed' : 'completed',
          );
        } catch {
          // The saved transcript remains visible if refresh is unavailable.
        }
      })();
    };
    source.addEventListener('started', onEvent);
    source.addEventListener('output', onEvent);
    source.addEventListener('succeeded', onEvent);
    source.addEventListener('failed', onEvent);
    source.addEventListener('cancelled', onEvent);
    source.addEventListener('message', onEvent);
    return () => {
      source.close();
      if (eventSourceRef.current === source) eventSourceRef.current = null;
    };
  }, [applyRunEvent, commitTimelineEnvelopes, selection, status, teamSession]);

  async function selectChat(nextSessionId: string) {
    if (
      (status === 'running' && selection?.kind !== 'team_agent_session') ||
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

  async function selectTeamSession(
    session: TeamSession,
    existingOperation?: number,
    projectOverride?: TeamProject,
  ) {
    const project = projectOverride ?? teamProject;
    if (
      !project ||
      (navigationPendingRef.current && existingOperation === undefined)
    ) {
      setMobileSidebarOpen(false);
      return;
    }
    const operation = existingOperation ?? beginNavigation();
    if (operation === null) return;
    updateTeamUrl(project.root_task_id, session.agent_session_id);
    const nextSelection: ChatSelection = {
      kind: 'team_agent_session',
      rootTaskId: project.root_task_id,
      teamRunId: project.team_run_id,
      memberRunId: session.agent_session_id,
    };
    selectionEpochRef.current += 1;
    runEpochRef.current += 1;
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setSseConnected(false);
    setError(undefined);
    setStatus('loading');
    setSessionId(undefined);
    runTrackingRef.current = null;
    setSseConnected(false);
    setSelection(nextSelection);
    setTeamSession(undefined);
    setMessages([]);
    commitTimeline(initialTimelineState);
    setReplayStatus({});
    setActiveTaskId(undefined);
    setActiveRunId(undefined);
    setRunDetails({});
    try {
      const response = await fetch(
        `/api/team-project/sessions/${encodeURIComponent(session.agent_session_id)}?task=${encodeURIComponent(project.root_task_id)}`,
        { cache: 'no-store' },
      );
      if (!response.ok) throw new Error('team session');
      const data = (await response.json()) as TeamSessionResponse;
      const eventResults = await Promise.all(
        data.turns.map(async (turn) => {
          const envelopes: TimelineEnvelope[] = [
            {
              runId: turn.run_id,
              update: { kind: 'prompt', text: turn.assignment_summary },
            },
          ];
          try {
            const eventsResponse = await fetch(
              `/api/team-project/sessions/${encodeURIComponent(session.agent_session_id)}/runs/${encodeURIComponent(turn.run_id)}/events?task=${encodeURIComponent(project.root_task_id)}`,
              { cache: 'no-store' },
            );
            if (!eventsResponse.ok) throw new Error('team events');
            const eventData = (await eventsResponse.json()) as {
              events: SafeRunEvent[];
            };
            for (const event of eventData.events) {
              const parsed = parseRunStreamEvent(JSON.stringify(event));
              if (parsed)
                envelopes.push({
                  runId: turn.run_id,
                  update: { kind: 'runEvent', event: parsed },
                });
            }
            if (turn.result_summary)
              envelopes.push({
                runId: turn.run_id,
                update: {
                  kind: 'canonicalAgentText',
                  text: turn.result_summary,
                },
              });
            return [turn.run_id, envelopes, 'ready' as const] as const;
          } catch {
            if (turn.result_summary)
              envelopes.push({
                runId: turn.run_id,
                update: {
                  kind: 'canonicalAgentText',
                  text: turn.result_summary,
                },
              });
            return [turn.run_id, envelopes, 'unavailable' as const] as const;
          }
        }),
      );
      setTeamSession(data);
      const hydrated = applyTimelineEnvelopes(
        initialTimelineState,
        eventResults.flatMap(([, envelopes]) => envelopes),
      );
      commitTimeline(hydrated);
      setReplayStatus(
        Object.fromEntries(
          eventResults.map(([runId, , replay]) => [runId, replay]),
        ),
      );
      setRunDetails({
        taskId: data.turns.at(-1)?.task_id,
        runId: data.turns.at(-1)?.run_id,
      });
      setStatus(
        data.turns.some((turn) => turn.status === 'running')
          ? 'running'
          : 'completed',
      );
    } catch {
      setError('This Agent Session could not be opened.');
      setStatus('failed');
    } finally {
      setMobileSidebarOpen(false);
      if (existingOperation === undefined) finishNavigation(operation);
    }
  }

  async function selectTeamOverview(
    projectOverride?: TeamProject,
    existingOperation?: number,
  ) {
    const project = projectOverride ?? teamProject;
    if (
      !project ||
      (navigationPendingRef.current && existingOperation === undefined)
    )
      return;
    const operation = existingOperation ?? beginNavigation();
    if (operation === null) return;
    updateTeamUrl(project.root_task_id);
    selectionEpochRef.current += 1;
    runEpochRef.current += 1;
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setSessionId(undefined);
    setSelection({
      kind: 'team_overview',
      rootTaskId: project.root_task_id,
      teamRunId: project.team_run_id,
    });
    setTeamSession(undefined);
    setMessages([]);
    commitTimeline(initialTimelineState);
    setReplayStatus({});
    setActiveTaskId(undefined);
    setActiveRunId(undefined);
    setRunDetails({});
    runTrackingRef.current = null;
    setSseConnected(false);
    setError(undefined);
    setStatus(
      project.status === 'failed'
        ? 'failed'
        : project.status === 'completed'
          ? 'completed'
          : 'running',
    );
    setMobileSidebarOpen(false);
    if (existingOperation === undefined) finishNavigation(operation);
  }

  selectTeamSessionRef.current = selectTeamSession;

  useEffect(() => {
    const requestedTeam = readTeamUrlSelection();
    const selectedTeam =
      selection?.kind === 'team_agent_session' ||
      selection?.kind === 'team_overview';
    if (!selectedTeam && !requestedTeam) return;

    let disposed = false;
    let inFlight = false;
    const poll = async () => {
      if (disposed || inFlight) return;
      inFlight = true;
      try {
        const project = await refreshTeamProject();
        if (disposed || !project) return;
        const currentRequestedTeam = readTeamUrlSelection();
        if (
          selection ||
          !currentRequestedTeam ||
          project.root_task_id !== currentRequestedTeam.rootTaskId
        )
          return;
        if (!currentRequestedTeam.memberRunId) {
          await selectTeamOverview(project);
          return;
        }
        const teamSession = project.sessions.find(
          (session) =>
            session.agent_session_id === currentRequestedTeam.memberRunId,
        );
        if (teamSession) {
          await selectTeamSessionRef.current?.(teamSession, undefined, project);
        }
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const interval = window.setInterval(() => void poll(), 3_000);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [refreshTeamProject, selection]);

  async function createChat() {
    if (
      (status === 'running' && selection?.kind !== 'team_agent_session') ||
      navigationPendingRef.current
    )
      return;
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
      if (submitted.run_id)
        commitTimelineEnvelopes([
          {
            runId: submitted.run_id,
            update: {
              kind: 'prompt',
              text: messageText,
              messageId: submitted.id,
            },
          },
        ]);
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
            canonicalAssistant: null,
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
  const selectedTeam = selection?.kind === 'team_agent_session';
  const selectedOverview = selection?.kind === 'team_overview';
  const capabilities = selectCapabilities({
    selection,
    read_only: selectedTeam || selectedOverview,
  });

  return (
    <main className="page-shell">
      <section className="chat-frame" aria-label="Agent Server Web Chat">
        <ConversationSidebar
          chats={sidebarChats}
          project={teamProject}
          selectedSessionId={sessionId}
          selectedTeamSessionId={
            selectedTeam ? selection.memberRunId : undefined
          }
          selectedProjectRootTaskId={
            selectedOverview ? selection.rootTaskId : undefined
          }
          disabled={
            (status === 'running' &&
              selection?.kind !== 'team_agent_session' &&
              selection?.kind !== 'team_overview') ||
            navigationPending
          }
          mobileOpen={mobileSidebarOpen}
          onNewChat={() => void createChat()}
          onSelect={(id) => void selectChat(id)}
          onSelectTeam={(session) => void selectTeamSession(session)}
          onSelectProject={() => void selectTeamOverview()}
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
                <p className="eyebrow">
                  {selectedOverview
                    ? 'Team Overview'
                    : selectedTeam
                      ? 'Selected Agent Session'
                      : 'Selected ProductSession'}
                </p>
                <h1>
                  {selectedOverview
                    ? (teamProject?.name ?? 'Team Project')
                    : selectedTeam
                      ? (teamSession?.name ?? 'Agent Session')
                      : 'Research Desk'}
                </h1>
              </div>
            </div>
            <div className="header-state">
              <span className={`status ${status}`} aria-live="polite">
                {statusLabel(status)}
              </span>
              <span className="state-detail">
                {selectedOverview
                  ? 'Shared Work Board · read-only'
                  : selectedTeam
                    ? `${teamSession?.role === 'lead' ? 'Lead' : 'Member'} · read-only transcript`
                    : 'Same Agent · same runtime context'}
              </span>
            </div>
            {!selectedTeam && !selectedOverview ? (
              <details className="run-details-disclosure">
                <summary>Details</summary>
                <RunDetails
                  timeline={timeline}
                  status={status}
                  sessionId={sessionId}
                  taskId={runDetails.taskId}
                  runId={runDetails.runId}
                  connected={sseConnected}
                />
              </details>
            ) : null}
          </header>
          <div className="chat-layout">
            <ChatSurface
              messages={messages}
              activeRunId={activeRunId}
              entries={timeline}
              capabilities={capabilities}
              now={now}
              replayStatus={replayStatus}
              teamProject={teamProject}
              teamSession={teamSession}
              status={status}
              error={error}
              retryText={retryText}
              text={text}
              setText={setText}
              pending={navigationPending}
              onPrompt={setText}
              onSend={() => void sendMessage()}
              onRetry={() => void sendMessage(retryText)}
            />
          </div>
        </section>
      </section>
    </main>
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
