import { useEffect, useMemo, useState } from 'react';

import type {
  ChatCommands,
  Conversation,
  Coworker,
  WorkListItem,
} from '../components/chat/contracts';
import {
  admitConversationToWork,
  loadContextFile,
  loadContextFiles,
  promoteConversationToUser,
  publishWorkResult,
  type ContextFileDetail,
  type ContextFileListing,
  type ContextScopeRequest,
} from '../api/context';
import TitleBar from './TitleBar';

type ScopeChoice = Readonly<{
  key: string;
  label: string;
  kind: string;
  request: ContextScopeRequest;
  conversation?: Conversation;
  work?: WorkListItem;
  agent?: Coworker;
}>;

export function FilesSurface({ commands }: { readonly commands: ChatCommands }) {
  const [coworkers, setCoworkers] = useState<readonly Coworker[]>([]);
  const [conversations, setConversations] = useState<readonly Conversation[]>([]);
  const [works, setWorks] = useState<readonly WorkListItem[]>([]);
  const [selectedKey, setSelectedKey] = useState('workspace');
  const [listing, setListing] = useState<ContextFileListing | null>(null);
  const [file, setFile] = useState<ContextFileDetail | null>(null);
  const [targetWorkId, setTargetWorkId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      commands.loadCoworkers(),
      commands.loadConversations(),
      commands.loadWorks(),
    ]).then(
      ([nextCoworkers, nextConversations, nextWorks]) => {
        if (!active) return;
        setCoworkers(nextCoworkers);
        setConversations(nextConversations);
        setWorks(nextWorks);
        setTargetWorkId(nextWorks[0]?.id ?? '');
      },
      (reason: unknown) =>
        active && setError(reason instanceof Error ? reason.message : String(reason)),
    );
    return () => {
      active = false;
    };
  }, [commands]);

  const choices = useMemo<readonly ScopeChoice[]>(() => {
    const result: ScopeChoice[] = [
      { key: 'workspace', label: 'Workspace', kind: 'Workspace', request: { scope: 'workspace' } },
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
        label: conversation.directAgent?.displayName ?? conversation.title ?? 'Conversation',
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
  const selected = choices.find((choice) => choice.key === selectedKey) ?? choices[0]!;

  useEffect(() => {
    if (!selected) return;
    let active = true;
    setFile(null);
    setListing(null);
    setError(null);
    void loadContextFiles(selected.request).then(
      (next) => active && setListing(next),
      (reason: unknown) => active && setError(reason instanceof Error ? reason.message : String(reason)),
    );
    return () => {
      active = false;
    };
  }, [selected?.key]);

  async function openFile(path: string): Promise<void> {
    setError(null);
    try {
      setFile(await loadContextFile(selected.request, path));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
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
      <aside className="sidebar n3-pane" aria-label="Files and Context navigation">
        <div className="pane-heading"><div><span className="eyebrow">Shared world</span><h1>Files</h1></div></div>
        <div className="n3-scope-list">
          {choices.map((choice) => (
            <button
              type="button"
              key={choice.key}
              data-active={choice.key === selected.key ? 'true' : 'false'}
              onClick={() => setSelectedKey(choice.key)}
            >
              <small>{choice.kind}</small><strong>{choice.label}</strong>
            </button>
          ))}
        </div>
      </aside>

      <main className="chat-panel n3-main">
        <TitleBar section="Files" />
        <section className="n3-files" aria-label="Context files">
          <header className="n3-files-header">
            <div><span className="eyebrow">{selected.kind}</span><h1>{selected.label}</h1></div>
            <span className="n3-access">{listing?.access === 'read_only' ? 'Read only' : 'Read / write'}</span>
          </header>
          {error ? <p className="n3-error" role="alert">{error}</p> : null}
          {notice ? <p className="n3-notice" role="status">{notice}</p> : null}
          <div className="n3-files-grid">
            <div className="n3-file-list">
              {listing === null ? <p className="pane-placeholder">Loading context…</p> : null}
              {listing?.entries.length === 0 ? <p className="pane-placeholder">No files in this canonical scope.</p> : null}
              {listing?.entries.map((entry) => (
                <button type="button" key={entry.id} data-active={file?.id === entry.id ? 'true' : 'false'} onClick={() => void openFile(entry.path)}>
                  <strong>{entry.path}</strong>
                  <small>v{entry.currentVersion} · {shortHash(entry.contentSha256)}</small>
                </button>
              ))}
            </div>
            <article className="n3-file-viewer">
              {!file ? <div className="work-main-empty"><span className="work-main-icon">▱</span><h1>Choose a file</h1><p>This surface shows ContextFS product facts, never a provider cwd.</p></div> : (
                <>
                  <header><div><span className="eyebrow">Canonical ContextFS</span><h2>{file.path}</h2></div><span className="n3-mono">{shortHash(file.contentSha256)}</span></header>
                  <pre>{file.content}</pre>
                  <div className="n3-file-actions">
                    {selected.conversation?.directAgent ? (
                      <button type="button" onClick={() => void promoteToRelationship()}>Promote to my memory</button>
                    ) : null}
                    {selected.conversation && works.length ? (
                      <label>Admit to Work
                        <select value={targetWorkId} onChange={(event) => setTargetWorkId(event.target.value)}>
                          {works.map((work) => <option key={work.id} value={work.id}>{work.title}</option>)}
                        </select>
                        <button type="button" disabled={!targetWorkId} onClick={() => void admitToWork()}>Admit input</button>
                      </label>
                    ) : null}
                    {selected.work && !file.path.startsWith('artifacts/') ? (
                      <button type="button" onClick={() => void publishResult()}>Publish as Work result</button>
                    ) : null}
                  </div>
                </>
              )}
            </article>
          </div>
        </section>
      </main>
    </>
  );
}

function basename(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? 'context.txt';
}
function shortHash(value: string): string {
  return value.startsWith('sha256:') ? `${value.slice(0, 15)}…` : `${value.slice(0, 12)}…`;
}

export default FilesSurface;
