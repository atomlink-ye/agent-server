import { useT } from '../../../../i18n';

export function ArtifactsPane() {
  const t = useT();
  return (
    <section
      className="work-capability-unavailable"
      data-testid="artifacts-unavailable"
    >
      <p className="work-shell-kicker">{t('work.scope.filesUnavailable')}</p>
      <h2>{t('work.artifacts.emptyTitle')}</h2>
      <p>{t('work.scope.filesUnavailableBody')}</p>
    </section>
  );
}
