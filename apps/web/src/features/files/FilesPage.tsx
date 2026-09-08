import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { loadConversations } from '../conversations/conversations-gateway';
import { loadCoworkers } from '../agents/agents-gateway';
import { workClient } from '../work/clients/work-client';
import { isFeatureUnavailable } from '../../api/feature-availability';
import { ApiTransportError } from '../../api/transport';
import {
  parseWorkRunResultFileRoute,
  workFilePath,
  workTabPath,
} from '../../app/routes';
import {
  coworkerFilePath,
  hasCoworkerFileScopeQuery,
  parseCoworkerFileRoute,
} from './coworker-file-route';
import { AssistantMarkdown } from '../conversations/components/assistant-markdown';
import {
  admitConversationToWork,
  loadContextFile,
  loadContextFiles,
  promoteConversationToUser,
  publishWorkResult,
  type ContextFileDetail,
  type ContextFileListing,
  type ContextScopeRequest,
} from './files-gateway';
import TitleBar from '../../app/shell/TitleBar';
import './files.css';

type Conversation = Awaited<ReturnType<typeof loadConversations>>[number];
type Coworker = Awaited<ReturnType<typeof loadCoworkers>>[number];
type WorkListItem = Awaited<
  ReturnType<typeof workClient.list>
>['works'][number];

type ScopeChoice = Readonly<{
  key: string;
  label: string;
  kind: string;
  request: ContextScopeRequest;
  conversation?: Conversation;
  work?: WorkListItem;
  agent?: Coworker;
}>;

export function FilesPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const resultRoute = parseWorkRunResultFileRoute(location.search);
  const coworkerRoute = resultRoute
    ? null
    : parseCoworkerFileRoute(location.search);
  const malformedCoworkerRoute =
    !resultRoute &&
    hasCoworkerFileScopeQuery(location.search) &&
    coworkerRoute === null;
  const [coworkers, setCoworkers] = useState<readonly Coworker[]>([]);
  const [coworkersState, setCoworkersState] = useState<
    'loading' | 'ready' | 'error'
  >('loading');
  const [rosterReload, setRosterReload] = useState(0);
  const [conversations, setConversations] = useState<readonly Conversation[]>(
    [],
  );
  const [works, setWorks] = useState<readonly WorkListItem[]>([]);
  const [selectedKey, setSelectedKey] = useState('workspace');
  const [listing, setListing] = useState<ContextFileListing | null>(null);
  const [file, setFile] = useState<ContextFileDetail | null>(null);
  const [fileScopeKey, setFileScopeKey] = useState<string | null>(null);
  const [targetWorkId, setTargetWorkId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fileState, setFileState] = useState<
    'idle' | 'loading' | 'missing' | 'error' | 'loaded'
  >('idle');
  const [viewerMode, setViewerMode] = useState<'markdown' | 'source'>(
    'markdown',
  );
  const [autoAdvanced, setAutoAdvanced] = useState(false);
  const autoAdvanceAttempts = useRef<Set<string>>(new Set());
  const fileRequest = useRef(0);

  useEffect(() => {
    // Coworkers, conversations and Work are three independent scope
    // sources: one surface failing must not discard the other two, so each
    // load runs and reports on its own rather than sharing a Promise.all
    // that would collapse all three results to the single rejection.
    let active = true;
    void loadCoworkers().then(
      (next) => {
        if (!active) return;
        setCoworkers(next);
        setCoworkersState('ready');
      },
      (reason: unknown) => {
        if (!active) return;
        setCoworkersState('error');
        setError(reason instanceof Error ? reason.message : String(reason));
      },
    );
    void loadConversations().then(
      (next) => active && setConversations(next),
      (reason: unknown) =>
        active &&
        setError(reason instanceof Error ? reason.message : String(reason)),
    );
    void workClient.list().then(
      (response) => {
        if (!active) return;
        setWorks(response.works);
        setTargetWorkId(response.works[0]?.id ?? '');
      },
      (reason: unknown) => {
        if (!active) return;
        // A workspace that does not compose the Work surface is a
        // non-error absence of Work-derived scopes: Files itself still
        // works, it simply offers no Work scopes, so this must not surface
        // through the error alert. A genuine transport failure of Work
        // still must, same as coworkers/conversations.
        if (isFeatureUnavailable(reason)) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      },
    );
    return () => {
      active = false;
    };
  }, [rosterReload]);

  const choices = useMemo<readonly ScopeChoice[]>(() => {
    const result: ScopeChoice[] = [
      {
        key: 'workspace',
        label: 'Workspace',
        kind: 'Workspace',
        request: { scope: 'workspace' },
      },
    ];
    for (const agent of coworkers) {
      result.push({
        key: `agent:${agent.id}`,
        label: agent.displayName,
        kind: 'Agent',
        agent,
        request: { scope: 'agent', agentDefinitionId: agent.id },
      });
      result.push({
        key: `agent-user:${agent.id}`,
        label: `You + ${agent.displayName}`,
        kind: 'Relationship',
        agent,
        request: { scope: 'agent_user', agentDefinitionId: agent.id },
      });
    }
    for (const conversation of conversations) {
      result.push({
        key: `conversation:${conversation.id}`,
        label:
          conversation.directAgent?.displayName ??
          conversation.title ??
          'Conversation',
        kind: 'Conversation',
        conversation,
        request: { scope: 'conversation', conversationId: conversation.id },
      });
    }
    for (const work of works) {
      result.push({
        key: `work:${work.id}`,
        label: work.title,
        kind: 'Work',
        work,
        request: { scope: 'work', workId: work.id },
      });
    }
    return result;
  }, [conversations, coworkers, works]);
  // Agent and Relationship (agent_user) scopes describe the same coworker
  // and are near-always shown together, so the sidebar renders them as one
  // grouped row with a compact scope toggle instead of two stacked rows.
  const listGroups = useMemo<
    readonly (
      | { readonly type: 'single'; readonly choice: ScopeChoice }
      | {
          readonly type: 'agent';
          readonly agentChoice: ScopeChoice;
          readonly relationshipChoice: ScopeChoice | null;
        }
    )[]
  >(() => {
    const groups: (
      | { type: 'single'; choice: ScopeChoice }
      | {
          type: 'agent';
          agentChoice: ScopeChoice;
          relationshipChoice: ScopeChoice | null;
        }
    )[] = [];
    const consumed = new Set<string>();
    for (const choice of choices) {
      if (consumed.has(choice.key)) continue;
      if (choice.kind === 'Agent' && choice.agent) {
        const relationshipChoice =
          choices.find((c) => c.key === `agent-user:${choice.agent!.id}`) ??
          null;
        consumed.add(choice.key);
        if (relationshipChoice) consumed.add(relationshipChoice.key);
        groups.push({ type: 'agent', agentChoice: choice, relationshipChoice });
        continue;
      }
      if (choice.kind === 'Relationship') continue;
      groups.push({ type: 'single', choice });
    }
    for (const choice of choices) {
      if (choice.kind === 'Relationship' && !consumed.has(choice.key)) {
        groups.push({ type: 'single', choice });
      }
    }
    return groups;
  }, [choices]);
  const requestedWorkChoice = resultRoute
    ? (choices.find(
        (choice) => choice.key === `work:${resultRoute.workId}`,
      ) ?? {
        key: `work:${resultRoute.workId}`,
        label: 'Work result',
        kind: 'Work',
        request: { scope: 'work' as const, workId: resultRoute.workId },
      })
    : null;
  const requestedCoworkerChoice = coworkerRoute
    ? (choices.find(
        (choice) =>
          choice.key ===
          `${coworkerRoute.scope.replace('_', '-')}:${coworkerRoute.agentDefinitionId}`,
      ) ?? null)
    : null;
  const pendingCoworkerRoute =
    coworkerRoute !== null &&
    requestedCoworkerChoice === null &&
    coworkersState === 'loading';
  const coworkerRosterError =
    coworkerRoute !== null &&
    requestedCoworkerChoice === null &&
    coworkersState === 'error';
  const unavailableCoworkerRoute =
    malformedCoworkerRoute ||
    (coworkerRoute !== null &&
      requestedCoworkerChoice === null &&
      coworkersState === 'ready');
  const showingCoworkerRouteState =
    pendingCoworkerRoute || coworkerRosterError || unavailableCoworkerRoute;
  const selected =
    requestedWorkChoice ??
    requestedCoworkerChoice ??
    choices.find((choice) => choice.key === selectedKey) ??
    choices[0]!;
  const selectedWorkId =
    selected.request.scope === 'work' ? selected.request.workId : null;
  const visibleFile =
    file &&
    fileScopeKey === selected.key &&
    (!resultRoute || file.path === resultRoute.path) &&
    (!coworkerRoute ||
      (coworkerRoute.path !== null && file.path === coworkerRoute.path))
      ? file
      : null;

  useEffect(() => {
    if (pendingCoworkerRoute || coworkerRosterError || unavailableCoworkerRoute)
      return;
    let active = true;
    fileRequest.current += 1;
    setFile(null);
    setFileScopeKey(null);
    setFileState('idle');
    setListing(null);
    setError(null);
    void loadContextFiles(selected.request).then(
      (next) => active && setListing(next),
      (reason: unknown) =>
        active &&
        setError(reason instanceof Error ? reason.message : String(reason)),
    );
    return () => {
      active = false;
    };
  }, [
    coworkerRosterError,
    pendingCoworkerRoute,
    selected.key,
    unavailableCoworkerRoute,
  ]);

  useEffect(() => {
    // The default landing scope is Workspace, but Workspace-scoped context
    // entries are often never written in a given deployment (everything
    // lives under Agent/Work scope instead). Rather than strand the user on
    // a permanently empty default, walk candidate scopes (Agent, then Work)
    // until one actually has files. This only runs before the user has made
    // any explicit scope choice of their own, and never during an explicit
    // Work-result or Coworker-file route.
    if (autoAdvanced || resultRoute || coworkerRoute || !listing) return;
    if (listing.entries.length > 0) {
      setAutoAdvanced(true);
      return;
    }
    autoAdvanceAttempts.current.add(selected.key);
    const next = choices.find(
      (choice) =>
        (choice.kind === 'Agent' || choice.kind === 'Work') &&
        !autoAdvanceAttempts.current.has(choice.key),
    );
    if (next) {
      setSelectedKey(next.key);
    } else {
      setAutoAdvanced(true);
    }
  }, [autoAdvanced, resultRoute, coworkerRoute, listing, choices, selected.key]);

  useEffect(() => {
    if (!resultRoute || !selectedWorkId) return;
    let active = true;
    const requestId = ++fileRequest.current;
    setFile(null);
    setFileScopeKey(null);
    setFileState('loading');
    setError(null);
    void loadContextFile(
      { scope: 'work', workId: selectedWorkId },
      resultRoute.path,
    ).then(
      (next) => {
        if (!active || requestId !== fileRequest.current) return;
        setFile(next);
        setFileScopeKey(selected.key);
        setFileState('loaded');
      },
      (reason: unknown) => {
        if (!active || requestId !== fileRequest.current) return;
        setFileState(
          reason instanceof ApiTransportError && reason.status === 404
            ? 'missing'
            : 'error',
        );
        if (!(reason instanceof ApiTransportError && reason.status === 404))
          setError(reason instanceof Error ? reason.message : String(reason));
      },
    );
    return () => {
      active = false;
      fileRequest.current += 1;
    };
  }, [resultRoute?.path, selected.key, selectedWorkId]);

  useEffect(() => {
    if (!coworkerRoute || !requestedCoworkerChoice) return;
    if (!coworkerRoute.path) {
      fileRequest.current += 1;
      setFile(null);
      setFileScopeKey(null);
      setFileState('idle');
      return;
    }
    let active = true;
    const requestId = ++fileRequest.current;
    setFile(null);
    setFileScopeKey(null);
    setFileState('loading');
    setError(null);
    void loadContextFile(
      requestedCoworkerChoice.request,
      coworkerRoute.path,
    ).then(
      (next) => {
        if (!active || requestId !== fileRequest.current) return;
        setFile(next);
        setFileScopeKey(requestedCoworkerChoice.key);
        setFileState('loaded');
      },
      (reason: unknown) => {
        if (!active || requestId !== fileRequest.current) return;
        setFileState(
          reason instanceof ApiTransportError && reason.status === 404
            ? 'missing'
            : 'error',
        );
        if (!(reason instanceof ApiTransportError && reason.status === 404))
          setError(reason instanceof Error ? reason.message : String(reason));
      },
    );
    return () => {
      active = false;
      fileRequest.current += 1;
    };
  }, [coworkerRoute?.path, requestedCoworkerChoice?.key]);

  function openFile(path: string): void {
    if (selectedWorkId) {
      navigate(
        workFilePath(
          selectedWorkId,
          path,
          resultRoute?.workRunId ?? null,
          resultRoute?.originConversationId ?? null,
        ),
      );
      return;
    }
    if (
      selected.request.scope === 'agent' ||
      selected.request.scope === 'agent_user'
    ) {
      navigate(
        coworkerFilePath(
          selected.request.scope,
          selected.request.agentDefinitionId!,
          path,
        ),
      );
      return;
    }
    const requestId = ++fileRequest.current;
    setError(null);
    setFileState('loading');
    setFile(null);
    setFileScopeKey(null);
    void loadContextFile(selected.request, path).then(
      (next) => {
        if (requestId !== fileRequest.current) return;
        setFile(next);
        setFileScopeKey(selected.key);
        setFileState('loaded');
      },
      (reason: unknown) => {
        if (requestId !== fileRequest.current) return;
        setFileState('error');
        setError(reason instanceof Error ? reason.message : String(reason));
      },
    );
  }

  async function copyRawContent(): Promise<void> {
    if (!visibleFile) return;
    setError(null);
    try {
      await navigator.clipboard.writeText(visibleFile.content);
      setNotice('Raw Markdown copied.');
    } catch {
      setError('Raw Markdown could not be copied.');
    }
  }

  function downloadRawContent(): void {
    if (!visibleFile) return;
    const url = URL.createObjectURL(
      new Blob([visibleFile.content], { type: 'text/markdown;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = basename(visibleFile.path);
    link.click();
    URL.revokeObjectURL(url);
  }

  function backToWork(): void {
    if (!resultRoute || !resultRoute.workRunId) return;
    navigate(
      workTabPath(
        resultRoute.workId,
        'overview',
        resultRoute.workRunId,
        resultRoute.originConversationId,
      ),
    );
  }

  function selectScope(key: string): void {
    setAutoAdvanced(true);
    setSelectedKey(key);
    const choice = choices.find((item) => item.key === key);
    if (
      choice?.request.scope === 'agent' ||
      choice?.request.scope === 'agent_user'
    ) {
      navigate(
        coworkerFilePath(
          choice.request.scope,
          choice.request.agentDefinitionId!,
        ),
      );
      return;
    }
    if (resultRoute || coworkerRoute || malformedCoworkerRoute)
      navigate('/files');
  }

  async function promoteToRelationship(): Promise<void> {
    if (!file || !selected.conversation?.directAgent) return;
    setError(null);
    setNotice(null);
    try {
      await promoteConversationToUser({
        agentDefinitionId: selected.conversation.directAgent.agentDefinitionId,
        conversationId: selected.conversation.id,
        sourcePath: file.path,
        targetPath: basename(file.path),
      });
      setNotice('Promoted to your private Agent relationship memory.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function admitToWork(): Promise<void> {
    if (!file || !selected.conversation || !targetWorkId) return;
    setError(null);
    setNotice(null);
    try {
      await admitConversationToWork({
        conversationId: selected.conversation.id,
        workId: targetWorkId,
        sourcePath: file.path,
        targetPath: `input/${basename(file.path)}`,
      });
      setNotice('Admitted into the selected Work input scope.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function publishResult(): Promise<void> {
    if (!file || !selected.work) return;
    setError(null);
    setNotice(null);
    try {
      await publishWorkResult({
        workId: selected.work.id,
        sourcePath: file.path,
        targetPath: `artifacts/${basename(file.path)}`,
      });
      setNotice('Published into the Work artifact surface.');
      setListing(await loadContextFiles(selected.request));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return (
    <>
      <aside
        className="sidebar files-pane"
        aria-label="Files and Context navigation"
      >
        <div className="pane-heading">
          <div>
            <span className="eyebrow">Shared world</span>
            <h1>Files</h1>
          </div>
        </div>
        <div className="files-scope-list">
          {listGroups.map((group) => {
            if (group.type === 'single') {
              const choice = group.choice;
              const active =
                !showingCoworkerRouteState && choice.key === selected.key;
              const showMeta =
                choice.kind.toLowerCase() !== choice.label.toLowerCase();
              return (
                <button
                  type="button"
                  key={choice.key}
                  data-active={active ? 'true' : 'false'}
                  onClick={() => selectScope(choice.key)}
                >
                  <span className="files-scope-title">{choice.label}</span>
                  {showMeta ? (
                    <span className="files-scope-meta">{choice.kind}</span>
                  ) : null}
                </button>
              );
            }
            const { agentChoice, relationshipChoice } = group;
            return (
              <div className="files-scope-agent" key={agentChoice.key}>
                <span className="files-scope-title">{agentChoice.label}</span>
                <div
                  className="files-scope-agent-tabs"
                  role="group"
                  aria-label={`${agentChoice.label} scope`}
                >
                  <button
                    type="button"
                    data-active={
                      !showingCoworkerRouteState &&
                      agentChoice.key === selected.key
                        ? 'true'
                        : 'false'
                    }
                    onClick={() => selectScope(agentChoice.key)}
                  >
                    Agent
                  </button>
                  {relationshipChoice ? (
                    <button
                      type="button"
                      data-active={
                        !showingCoworkerRouteState &&
                        relationshipChoice.key === selected.key
                          ? 'true'
                          : 'false'
                      }
                      onClick={() => selectScope(relationshipChoice.key)}
                    >
                      You + Agent
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </aside>

      <main className="chat-panel files-main">
        <TitleBar section="Files" />
        {pendingCoworkerRoute ? (
          <section className="files-files files-route-state" aria-live="polite">
            <div className="work-main-empty">
              <span className="work-main-icon" aria-hidden="true">
                ◎
              </span>
              <h1>Loading Coworker files…</h1>
              <p>Checking whether this Coworker is available to you.</p>
            </div>
          </section>
        ) : coworkerRosterError ? (
          <section className="files-files files-route-state">
            <div className="work-main-empty">
              <span className="work-main-icon" aria-hidden="true">
                !
              </span>
              <h1>Coworker files couldn&apos;t be loaded</h1>
              <p>Try again in a moment.</p>
              <button
                type="button"
                className="files-back"
                onClick={() => {
                  setError(null);
                  setCoworkersState('loading');
                  setRosterReload((value) => value + 1);
                }}
              >
                Retry
              </button>
            </div>
          </section>
        ) : unavailableCoworkerRoute ? (
          <section className="files-files files-route-state">
            <div className="work-main-empty">
              <span className="work-main-icon" aria-hidden="true">
                !
              </span>
              <h1>Coworker files unavailable</h1>
              <p>
                This link is invalid, or the Coworker is no longer available to
                you.
              </p>
              <Link className="files-back" to="/agents">
                Back to Coworkers
              </Link>
            </div>
          </section>
        ) : (
          <section className="files-files" aria-label="Context files">
            <header className="files-files-header">
              <div>
                <span className="eyebrow">{selected.kind}</span>
                <h1>{selected.label}</h1>
              </div>
              {resultRoute?.workRunId ? (
                <button
                  type="button"
                  className="files-back"
                  onClick={backToWork}
                >
                  Back to Work
                </button>
              ) : null}
              {selected.request.scope === 'agent' ||
              selected.request.scope === 'agent_user' ? (
                <Link
                  className="files-back"
                  to={`/agents/${encodeURIComponent(selected.request.agentDefinitionId!)}`}
                >
                  Back to Coworker Home
                </Link>
              ) : null}
              <span className="files-access">
                {selected.request.scope === 'agent' ||
                selected.request.scope === 'agent_user'
                  ? 'Preview only'
                  : listing?.access === 'read_only'
                    ? 'Read only'
                    : 'Read / write'}
              </span>
            </header>
            {error ? (
              <p className="files-error" role="alert">
                {error}
              </p>
            ) : null}
            {notice ? (
              <p className="files-notice" role="status">
                {notice}
              </p>
            ) : null}
            <div className="files-files-grid">
              <div className="files-file-list">
                {listing === null ? (
                  <p className="pane-placeholder">Loading context…</p>
                ) : null}
                {listing?.entries.length === 0 ? (
                  <p className="pane-placeholder">
                    No files in this canonical scope.
                  </p>
                ) : null}
                {listing?.entries.map((entry) => (
                  <button
                    type="button"
                    key={entry.id}
                    data-active={
                      visibleFile?.id === entry.id ? 'true' : 'false'
                    }
                    onClick={() => openFile(entry.path)}
                  >
                    <span className="files-scope-title">{entry.path}</span>
                    <span className="files-scope-meta">
                      v{entry.currentVersion} · {shortHash(entry.contentSha256)}
                    </span>
                  </button>
                ))}
              </div>
              <article className="files-file-viewer">
                {fileState === 'missing' && resultRoute ? (
                  <div
                    className="work-main-empty"
                    data-testid="result-file-missing"
                  >
                    <span className="work-main-icon">▱</span>
                    <h1>Result file unavailable</h1>
                    <p>
                      <code>{resultRoute.path}</code> is not available in this
                      Work scope.
                    </p>
                  </div>
                ) : fileState === 'missing' && coworkerRoute?.path ? (
                  <div className="work-main-empty">
                    <span className="work-main-icon">▱</span>
                    <h1>File unavailable</h1>
                    <p>
                      <code>{coworkerRoute.path}</code> is not available in this
                      Coworker scope.
                    </p>
                  </div>
                ) : !visibleFile ? (
                  <div className="files-viewer-idle">
                    <p>
                      {fileState === 'loading'
                        ? 'Loading file…'
                        : listing?.entries.length
                          ? 'Choose a file from the list.'
                          : 'No files in this scope yet.'}
                    </p>
                  </div>
                ) : (
                  <>
                    <header>
                      <div>
                        <span className="eyebrow">Canonical ContextFS</span>
                        <h2>{visibleFile.path}</h2>
                      </div>
                      <span className="files-mono">
                        {shortHash(visibleFile.contentSha256)}
                      </span>
                    </header>
                    <div
                      className="files-viewer-toolbar"
                      aria-label="File format"
                    >
                      <div role="group" aria-label="View mode">
                        <button
                          type="button"
                          data-active={
                            viewerMode === 'markdown' ? 'true' : 'false'
                          }
                          onClick={() => setViewerMode('markdown')}
                        >
                          Markdown
                        </button>
                        <button
                          type="button"
                          data-active={
                            viewerMode === 'source' ? 'true' : 'false'
                          }
                          onClick={() => setViewerMode('source')}
                        >
                          Source
                        </button>
                      </div>
                    </div>
                    <div className="files-rendered-markdown">
                      {viewerMode === 'markdown' ? (
                        <AssistantMarkdown text={visibleFile.content} />
                      ) : (
                        <pre>{visibleFile.content}</pre>
                      )}
                    </div>
                    <div className="files-file-actions">
                      <button
                        type="button"
                        onClick={() => void copyRawContent()}
                      >
                        Copy raw Markdown
                      </button>
                      <button type="button" onClick={downloadRawContent}>
                        Download .md
                      </button>
                      {selected.conversation?.directAgent ? (
                        <button
                          type="button"
                          onClick={() => void promoteToRelationship()}
                        >
                          Promote to my memory
                        </button>
                      ) : null}
                      {selected.conversation && works.length ? (
                        <label>
                          Admit to Work
                          <select
                            value={targetWorkId}
                            onChange={(event) =>
                              setTargetWorkId(event.target.value)
                            }
                          >
                            {works.map((work) => (
                              <option key={work.id} value={work.id}>
                                {work.title}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            disabled={!targetWorkId}
                            onClick={() => void admitToWork()}
                          >
                            Admit input
                          </button>
                        </label>
                      ) : null}
                      {selected.work && !file.path.startsWith('artifacts/') ? (
                        <button
                          type="button"
                          onClick={() => void publishResult()}
                        >
                          Publish as Work result
                        </button>
                      ) : null}
                    </div>
                  </>
                )}
              </article>
            </div>
          </section>
        )}
      </main>
    </>
  );
}

function basename(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? 'context.txt';
}

function shortHash(value: string): string {
  return value.startsWith('sha256:')
    ? `${value.slice(0, 15)}…`
    : `${value.slice(0, 12)}…`;
}

export default FilesPage;
