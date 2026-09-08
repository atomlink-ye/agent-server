import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  loadContextFiles,
  type ContextFileListing,
} from '../files/files-gateway';
import {
  coworkerFilePath,
  type CoworkerFileScope,
} from '../files/coworker-file-route';
import type { Coworker } from './contracts';
import { useT } from '../../i18n';

type ListingState =
  | { status: 'loading'; listing: null }
  | { status: 'ready'; listing: ContextFileListing }
  | { status: 'error'; listing: null };

const FILE_LIMIT = 3;

export function CoworkerHomeFiles({ agent }: { readonly agent: Coworker }) {
  const t = useT();
  const [sharedReload, setSharedReload] = useState(0);
  const [privateReload, setPrivateReload] = useState(0);
  const [shared, setShared] = useState<ListingState>({
    status: 'loading',
    listing: null,
  });
  const [privateFiles, setPrivateFiles] = useState<ListingState>({
    status: 'loading',
    listing: null,
  });

  useEffect(() => {
    let active = true;
    setShared({ status: 'loading', listing: null });
    void loadContextFiles({
      scope: 'agent',
      agentDefinitionId: agent.id,
    }).then(
      (listing) => active && setShared({ status: 'ready', listing }),
      () => active && setShared({ status: 'error', listing: null }),
    );
    return () => {
      active = false;
    };
  }, [agent.id, sharedReload]);

  useEffect(() => {
    let active = true;
    setPrivateFiles({ status: 'loading', listing: null });
    void loadContextFiles({
      scope: 'agent_user',
      agentDefinitionId: agent.id,
    }).then(
      (listing) => active && setPrivateFiles({ status: 'ready', listing }),
      () => active && setPrivateFiles({ status: 'error', listing: null }),
    );
    return () => {
      active = false;
    };
  }, [agent.id, privateReload]);

  return (
    <section
      className="agents-home-files"
      aria-labelledby="context-files-heading"
    >
      <div className="agents-section-heading">
        <div>
          <span className="eyebrow">{t('agents.home')}</span>
          <h2 id="context-files-heading">{t('agents.contextFiles')}</h2>
        </div>
      </div>
      <p className="agents-home-files-intro">{t('agents.contextFilesIntro')}</p>
      <div className="agents-home-files-grid">
        <ContextFileScope
          agentId={agent.id}
          heading={t('agents.sharedCoworkerFiles')}
          description={t('agents.sharedCoworkerFilesHint')}
          scope="agent"
          state={shared}
          onRetry={() => setSharedReload((value) => value + 1)}
        />
        <ContextFileScope
          agentId={agent.id}
          heading={t('agents.privateRelationshipFiles')}
          description={t('agents.privateRelationshipFilesHint')}
          scope="agent_user"
          state={privateFiles}
          onRetry={() => setPrivateReload((value) => value + 1)}
        />
      </div>
    </section>
  );
}

function ContextFileScope({
  agentId,
  heading,
  description,
  scope,
  state,
  onRetry,
}: {
  readonly agentId: string;
  readonly heading: string;
  readonly description: string;
  readonly scope: CoworkerFileScope;
  readonly state: ListingState;
  readonly onRetry: () => void;
}) {
  const t = useT();
  const files = state.listing?.entries ?? [];
  return (
    <article className="agents-home-file-scope">
      <div>
        <h3>{heading}</h3>
        <p>{description}</p>
      </div>
      {state.status === 'loading' ? (
        <p role="status">{t('agents.loadingFiles')}</p>
      ) : null}
      {state.status === 'error' ? (
        <div className="agents-home-files-error" role="alert">
          <p>{t('agents.filesLoadError')}</p>
          <button type="button" onClick={onRetry}>
            {t('common.retry')}
          </button>
        </div>
      ) : null}
      {state.status === 'ready' && files.length === 0 ? (
        <p>{t('agents.contextFilesEmpty')}</p>
      ) : null}
      {state.status === 'ready' && files.length > 0 ? (
        <>
          <p className="agents-home-file-count">
            {t('agents.fileCount', { count: files.length })}
          </p>
          <ul>
            {files.slice(0, FILE_LIMIT).map((file) => (
              <li key={file.id}>
                <Link to={coworkerFilePath(scope, agentId, file.path)}>
                  {file.path}
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <Link
        className="agents-home-files-link"
        to={coworkerFilePath(scope, agentId)}
      >
        {t('agents.previewFiles')}
      </Link>
    </article>
  );
}
