import { workTabHref } from '../work-presentation';
import { useT } from '../../../../i18n';

export function ArtifactsPane({ workId, originConversationId }: { readonly workId?: string; readonly originConversationId?: string | null }) {
  const t = useT();
  return (
    <section
      className="work-capability-unavailable"
      data-testid="artifacts-unavailable"
    >
      <p className="work-shell-kicker">{t('work.artifacts')}</p>
      <h2>{t('work.artifacts.emptyTitle')}</h2>
      <p>{t('work.artifacts.emptyBody')}</p>
      <a href={workId ? workTabHref(workId, 'runs', undefined, originConversationId) : '/work'}>{t('work.browseRuns')}</a>
    </section>
  );
}
