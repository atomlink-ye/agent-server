import type { ProductWorkDefinitionVersionResponse } from '@atomlink-ye/agent-server/product-contract';

import { humanize } from '@/components/work/work-presentation';

export function DefinitionPanel({
  selectedVersionId,
  version,
}: {
  readonly selectedVersionId: string;
  readonly version: ProductWorkDefinitionVersionResponse | null;
}) {
  if (!version)
    return (
      <section
        className="work-capability-unavailable"
        data-testid="definition-unavailable"
      >
        <p className="work-shell-kicker">Definition</p>
        <h2>The exact Definition version could not be loaded.</h2>
        <p>The selected Product version reference is:</p>
        <code className="work-definition-ref">{selectedVersionId}</code>
      </section>
    );

  const metadata = asRecord(version.source.metadata);
  const spec = asRecord(version.source.spec);
  const name = stringValue(metadata?.name) ?? 'Work Definition';
  const description = stringValue(metadata?.description);
  const kind = stringValue(spec?.kind) ?? 'not_captured';
  const environment = resourceBinding(
    spec,
    'environment_version_id',
    'environment',
  );
  const participants = participantsFromSource(kind, spec);

  return (
    <section className="work-definition" data-testid="definition-viewer">
      <div className="work-section-heading">
        <p className="work-shell-kicker">Definition</p>
        <h2>{name}</h2>
        <p>Exact immutable Product DefinitionVersion used by the selected Run.</p>
      </div>
      <dl className="work-definition__facts">
        <Fact label="Status" value={humanize(version.status)} />
        <Fact label="Composition" value={humanize(kind)} />
        <Fact label="Version reference" value={version.id} code />
        <Fact label="Fingerprint" value={version.fingerprint} code />
        <Fact
          label="Resolved manifest"
          value={
            version.resolved.resource_manifest_fingerprint ?? 'Not captured'
          }
          code={version.resolved.resource_manifest_fingerprint !== null}
        />
        <Fact
          label="Description"
          value={description ?? 'No description captured'}
        />
        <Fact label="Environment" value={environment.label} code={environment.code} />
      </dl>
      <div className="work-definition__agents">
        <h3>Participants</h3>
        {participants.length > 0 ? (
          <ul>
            {participants.map((participant) => (
              <li key={`${participant.role}:${participant.name}`}>
                <strong>
                  {participant.name} · {humanize(participant.role)}
                </strong>
                {participant.versionId ? (
                  <code>{participant.versionId}</code>
                ) : (
                  <span>Inline Agent materialized at apply</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p>Participant details were not captured in this author source.</p>
        )}
      </div>
    </section>
  );
}

function Fact({
  label,
  value,
  code = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly code?: boolean;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{code ? <code>{value}</code> : value}</dd>
    </div>
  );
}

type ParticipantView = {
  readonly name: string;
  readonly role: 'primary' | 'lead' | 'member';
  readonly versionId: string | null;
};

function participantsFromSource(
  kind: string,
  spec: Readonly<Record<string, unknown>> | null,
): readonly ParticipantView[] {
  if (!spec) return [];
  if (kind === 'single_agent')
    return [
      {
        name: 'Primary Agent',
        role: 'primary',
        versionId: stringValue(spec.agent_version_id),
      },
    ];
  if (kind !== 'collaboration') return [];

  const lead = asRecord(spec.lead);
  const members = Array.isArray(spec.members) ? spec.members : [];
  const result: ParticipantView[] = [];
  if (lead)
    result.push({
      name: stringValue(lead.name) ?? 'Lead',
      role: 'lead',
      versionId: stringValue(lead.agent_version_id),
    });
  for (const item of members) {
    const member = asRecord(item);
    if (!member) continue;
    result.push({
      name: stringValue(member.name) ?? 'Member',
      role: 'member',
      versionId: stringValue(member.agent_version_id),
    });
  }
  return result;
}

function resourceBinding(
  spec: Readonly<Record<string, unknown>> | null,
  versionKey: string,
  inlineKey: string,
): { readonly label: string; readonly code: boolean } {
  if (!spec) return { label: 'Not captured', code: false };
  const versionId = stringValue(spec[versionKey]);
  if (versionId) return { label: versionId, code: true };
  if (asRecord(spec[inlineKey]))
    return { label: 'Inline resource materialized at apply', code: false };
  return { label: 'Not captured', code: false };
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
