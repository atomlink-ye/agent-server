export type CapabilityInputType =
  'text' | 'number' | 'integer' | 'boolean' | 'select';

export interface CapabilityInputDraft {
  readonly label: string;
  readonly key: string;
  readonly type: CapabilityInputType;
  readonly required: boolean;
  readonly choices?: readonly string[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
}

export interface CapabilityParticipantDraft {
  readonly name: string;
  readonly role: string;
  readonly instructions: string;
}

export interface CapabilityDraft {
  readonly name: string;
  readonly description: string;
  readonly mode: 'single' | 'collaboration';
  readonly participants: readonly CapabilityParticipantDraft[];
  readonly inputs: readonly CapabilityInputDraft[];
}

export interface CompiledCapabilityDraft {
  readonly source: string;
  readonly normalizedName: string;
  readonly inputKeys: readonly string[];
}

/**
 * Friendly Capability drafts compile deterministically to the canonical
 * WorkDefinition author document. The generated source still goes through the
 * server's validate/plan/apply pipeline before it can become authoritative.
 */
export function compileCapabilityDraft(
  draft: CapabilityDraft,
): CompiledCapabilityDraft {
  const normalizedName = slug(draft.name);
  if (!draft.name.trim()) throw new Error('Give this Capability a name.');
  if (!draft.description.trim())
    throw new Error('Describe the outcome this Capability should deliver.');
  if (draft.mode === 'single' && draft.participants.length !== 1)
    throw new Error(
      'A single-specialist Capability needs exactly one participant.',
    );
  if (draft.mode === 'collaboration' && draft.participants.length < 2)
    throw new Error(
      'A small-team Capability needs a lead and at least one member.',
    );
  if (draft.participants.length > 17)
    throw new Error('A Capability can include at most 17 participants.');

  const participantNames = new Set<string>();
  for (const participant of draft.participants) {
    if (!participant.name.trim() || !participant.role.trim())
      throw new Error('Every participant needs a name and role.');
    if (!participant.instructions.trim())
      throw new Error(
        `Add working instructions for ${participant.name || 'the participant'}.`,
      );
    const key = participant.name.trim().toLocaleLowerCase();
    if (participantNames.has(key))
      throw new Error('Participant names must be unique.');
    participantNames.add(key);
  }

  const inputKeys = draft.inputs.map((input) =>
    normalizeInputKey(input.key || input.label),
  );
  if (new Set(inputKeys).size !== inputKeys.length)
    throw new Error('Input field names must be unique.');

  const environment = managedEnvironmentSource(`${normalizedName}-environment`);
  const lines = [
    'apiVersion: agentserver.dev/v1alpha1',
    'kind: WorkDefinition',
    'metadata:',
    `  name: ${normalizedName}`,
    `  description: ${scalar(draft.description.trim())}`,
    'spec:',
  ];

  if (draft.mode === 'single') {
    const participant = draft.participants[0]!;
    lines.push(
      '  kind: single_worker',
      '  worker:',
      '    source: |',
      ...indent(
        workerSource(normalizedName, participant, draft.description),
        6,
      ),
    );
  } else {
    const [lead, ...members] = draft.participants;
    lines.push(
      '  kind: collaboration',
      '  lead:',
      `    name: ${scalar(lead!.name.trim())}`,
      '    worker:',
      '      source: |',
    );
    lines.push(
      ...indent(workerSource(normalizedName, lead!, draft.description), 8),
      '  members:',
    );
    for (const member of members) {
      lines.push(
        `    - name: ${scalar(member.name.trim())}`,
        '      worker:',
        '        source: |',
        ...indent(workerSource(normalizedName, member, draft.description), 10),
      );
    }
  }

  lines.push('  environment:', '    source: |', ...indent(environment, 6));
  lines.push(
    '  memory_version_ids: []',
    '  input_schema:',
    '    type: object',
    '    properties:',
  );
  if (draft.inputs.length === 0) lines.push('      {}');
  draft.inputs.forEach((input, index) => {
    const key = inputKeys[index]!;
    lines.push(`      ${key}:`);
    if (input.type === 'text' || input.type === 'select') {
      lines.push('        type: string');
      if (input.minLength !== undefined)
        lines.push(
          `        min_length: ${nonNegativeInteger(input.minLength, input.label)}`,
        );
      if (input.maxLength !== undefined)
        lines.push(
          `        max_length: ${nonNegativeInteger(input.maxLength, input.label)}`,
        );
      if (input.type === 'select') {
        const choices = [
          ...new Set(
            (input.choices ?? []).map((v) => v.trim()).filter(Boolean),
          ),
        ];
        if (choices.length === 0)
          throw new Error(`${input.label || key} needs at least one choice.`);
        lines.push('        enum:');
        choices.forEach((choice) =>
          lines.push(`          - ${scalar(choice)}`),
        );
      }
    } else if (input.type === 'number' || input.type === 'integer') {
      lines.push(`        type: ${input.type}`);
      if (input.minimum !== undefined)
        lines.push(`        minimum: ${finite(input.minimum, input.label)}`);
      if (input.maximum !== undefined)
        lines.push(`        maximum: ${finite(input.maximum, input.label)}`);
    } else {
      lines.push('        type: boolean');
    }
  });
  const required = draft.inputs
    .map((input, index) => (input.required ? inputKeys[index]! : null))
    .filter((value): value is string => value !== null);
  lines.push('    required:');
  if (required.length === 0) lines.push('      []');
  else required.forEach((key) => lines.push(`      - ${key}`));
  lines.push('    additional_properties: false', '');

  return { source: lines.join('\n'), normalizedName, inputKeys };
}

function workerSource(
  capabilityName: string,
  participant: CapabilityParticipantDraft,
  outcome: string,
): string {
  return [
    'apiVersion: agent-server/v1alpha1',
    'kind: Worker',
    'metadata:',
    `  name: ${scalar(`${capabilityName}-${participant.name.trim()}`)}`,
    'spec:',
    `  description: ${scalar(`${participant.role.trim()} for ${outcome.trim()}`)}`,
    `  instructions: ${scalar(participant.instructions.trim())}`,
    '  runtime:',
    '    provider: paseo',
    '    modelPolicyRef: free-only',
    '    mode: isolated',
    '  tools: []',
    '  skills: []',
    '  input:',
    '    schema:',
    '      type: object',
    '      properties: {}',
    '      additionalProperties: false',
    `    prompt: ${scalar('Complete the assigned formal Work using the Work input and available context.')}`,
    '  session:',
    '    invocation: fresh_per_invocation',
    '    followUps: queued',
    '    binding: reusable',
    '  memory:',
    '    policy: workspace_snapshot',
    '    proposalLimit: 0',
    '  permissions:',
    '    network: read_only',
    '    filesystem: workspace_read',
    '  completion:',
    '    type: executable',
    `    command: ${scalar('done')}`,
    '',
  ].join('\n');
}

function managedEnvironmentSource(name: string): string {
  return [
    'apiVersion: agent-server/v1alpha1',
    'kind: ManagedEnvironment',
    'metadata:',
    `  name: ${name}`,
    'spec:',
    '  adapter: paseo',
    '  provider: opencode',
    '  modelPolicyRef: free-only',
    '  runtimeCellPolicy: per_runtime_session',
    '',
  ].join('\n');
}

export function normalizeInputKey(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const prefixed = /^[a-z_]/.test(normalized)
    ? normalized
    : `input_${normalized}`;
  if (!prefixed || prefixed === 'input_')
    throw new Error('Input fields need a stable name.');
  return prefixed.slice(0, 64);
}

export function slug(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  return normalized || `capability-${stableHash(value)}`;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function scalar(value: string): string {
  return JSON.stringify(value);
}
function indent(value: string, spaces: number): string[] {
  const prefix = ' '.repeat(spaces);
  return value.split('\n').map((line) => `${prefix}${line}`);
}
function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0)
    throw new Error(
      `${label || 'Input'} needs a non-negative whole-number bound.`,
    );
  return value;
}
function finite(value: number, label: string): number {
  if (!Number.isFinite(value))
    throw new Error(`${label || 'Input'} has an invalid numeric bound.`);
  return value;
}
