import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_MODEL_POLICY_REFS,
  MAX_SOURCE_BYTES,
  parseManagedAgentPackage,
  type ManagedAgentPackage,
} from './managed-agent-package.js';

const yaml = (extra = '') => `apiVersion: agent-server/v1alpha1
kind: ManagedAgent
metadata:
  name: researcher
spec:
  description: Researches a topic
  instructions: Be concise and cite sources.
  runtime:
    provider: paseo
    modelPolicyRef: ${BUILT_IN_MODEL_POLICY_REFS[0]}
    mode: isolated
  tools:
    - ref: web-search
      kind: tool
  skills:
    - ref: research
  input:
    schema:
      type: object
      properties:
        topic: { type: string, min: 1, additionalProperties: false }
      required: [topic]
      additionalProperties: false
    prompt: "Research {{ input.topic }}"
  session:
    invocation: fresh_per_invocation
    followUps: queued
    binding: reusable
  memory:
    policy: workspace_snapshot
    proposalLimit: 3
  permissions:
    network: read_only
    filesystem: none
  completion:
    type: executable
    command: "return result"
${extra}`;

function errorCode(
  source: string,
  options?: Parameters<typeof parseManagedAgentPackage>[1],
) {
  try {
    parseManagedAgentPackage(source, options);
    throw new Error('expected rejection');
  } catch (error) {
    return error as { code?: string; path?: string };
  }
}

describe('managed agent package', () => {
  it('parses a valid package into an immutable normalized value', () => {
    const result = parseManagedAgentPackage(yaml());
    expect(result.package.metadata.name).toBe('researcher');
    expect(result.package.spec.input.prompt).toEqual({
      segments: [{ text: 'Research ' }, { field: 'topic' }],
      template: 'Research {{ input.topic }}',
    });
    expect(Object.isFrozen(result.package)).toBe(true);
    expect(result.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('canonicalizes reordered YAML identically', () => {
    const a = parseManagedAgentPackage(yaml());
    const b = parseManagedAgentPackage(
      yaml().replace(
        'description: Researches a topic\n  instructions: Be concise and cite sources.',
        'instructions: Be concise and cite sources.\n  description: Researches a topic',
      ),
    );
    expect(a.canonicalJson).toBe(b.canonicalJson);
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  for (const [name, source] of [
    ['YAML 1.1 directive', '%YAML 1.1\n---\n' + yaml()],
    ['duplicate keys', yaml('metadata:\n  name: duplicate')],
    ['alias', 'x: &a hi\ny: *a'],
    ['anchor', 'x: &a hi'],
    ['tag', 'x: !!str hi'],
    ['merge', 'x: { <<: { a: b } }'],
  ] as const)
    it(`rejects ${name}`, () =>
      expect(() => parseManagedAgentPackage(source)).toThrow());

  it('rejects unknown fields and unsafe secret content without echoing it', () => {
    const secret = 'BEGIN OPENSSH PRIVATE KEY super-secret-value';
    const result = errorCode(
      yaml().replace('  description:', '  extra: nope\n  description:'),
    );
    expect(result.code).toBe('unknown_field');
    const leak = errorCode(
      yaml().replace('Be concise and cite sources.', `bearer ${secret}`),
    );
    expect(JSON.stringify(leak)).not.toContain(secret);
  });

  it('enforces source and AST complexity bounds', () => {
    expect(() =>
      parseManagedAgentPackage('x: ' + 'a'.repeat(MAX_SOURCE_BYTES)),
    ).toThrow();
    const tooManyTools = Array.from(
      { length: 65 },
      (_, i) => `    - ref: tool-${i}`,
    ).join('\n');
    expect(() =>
      parseManagedAgentPackage(
        yaml().replace('    - ref: web-search\n      kind: tool', tooManyTools),
      ),
    ).toThrow();
  });

  it('enforces model policy allowlists and forbids concrete model selection', () => {
    expect(() =>
      parseManagedAgentPackage(
        yaml().replace(BUILT_IN_MODEL_POLICY_REFS[0], 'paid'),
      ),
    ).toThrow();
    expect(() => parseManagedAgentPackage(yaml('  model: gpt-5'))).toThrow();
  });

  it('accepts only the constrained template grammar', () => {
    for (const prompt of [
      '{{ input.topic }}',
      '{{ input.missing }}',
      '{{ input.topic.name }}',
      '{{ input.topic | upper }}',
      '{{ input.topic }',
      '{{ input.topic }} {{ code }}',
    ]) {
      const source = yaml().replace('Research {{ input.topic }}', prompt);
      if (prompt === '{{ input.topic }}')
        expect(() => parseManagedAgentPackage(source)).not.toThrow();
      else expect(() => parseManagedAgentPackage(source)).toThrow();
    }
  });

  it('rejects prohibited JSON schema keywords', () => {
    for (const keyword of [
      '$ref',
      'oneOf',
      'anyOf',
      'allOf',
      'not',
      'const',
      'default',
    ]) {
      const source = yaml().replace(
        'type: string, min: 1',
        `type: string, ${keyword}: x`,
      );
      expect(() => parseManagedAgentPackage(source)).toThrow();
    }
  });

  it('deeply freezes all returned package values', () => {
    const value = parseManagedAgentPackage(yaml())
      .package as ManagedAgentPackage;
    expect(Object.isFrozen(value.spec.runtime)).toBe(true);
    expect(Object.isFrozen(value.spec.tools)).toBe(true);
    expect(() => {
      (value.metadata as { name: string }).name = 'changed';
    }).toThrow();
  });
});
