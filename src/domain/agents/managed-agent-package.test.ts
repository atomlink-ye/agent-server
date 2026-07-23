import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_MODEL_POLICY_REFS,
  MAX_AST_DEPTH,
  MAX_MANAGED_AGENT_NAME_BYTES,
  MAX_SCALAR_LENGTH,
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

function errorCode(source: string) {
  try {
    parseManagedAgentPackage(source);
    throw new Error('expected rejection');
  } catch (error) {
    if (error instanceof Error && error.message === 'expected rejection')
      throw error;
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

  it('returns immutable compiler identity outside the canonical user package', () => {
    const result = parseManagedAgentPackage(yaml());
    expect(result.compiler).toEqual({
      patternDialect: 're2',
      patternCompilerVersion: 're2js-2.8.6',
    });
    expect(Object.isFrozen(result.compiler)).toBe(true);
    expect(result.canonicalJson).not.toContain('re2js-2.8.6');
    expect(() => {
      (result.compiler as { patternDialect: string }).patternDialect = 'native';
    }).toThrow();
    expect(parseManagedAgentPackage(yaml()).fingerprint).toBe(
      result.fingerprint,
    );
  });

  it('normalizes and bounds metadata names by UTF-8 bytes before fingerprinting', () => {
    const ascii = 'a'.repeat(MAX_MANAGED_AGENT_NAME_BYTES);
    const exact = parseManagedAgentPackage(yaml().replace('researcher', ascii));
    expect(exact.normalizedName).toBe(ascii);
    expect(Buffer.byteLength(exact.normalizedName, 'utf8')).toBe(255);
    const asciiError = errorCode(yaml().replace('researcher', `${ascii}a`));
    expect(asciiError.code).toBe('invalid_name');
    expect(asciiError.path).toBe('$.metadata.name');
    expect(JSON.stringify(asciiError)).not.toContain(`${ascii}a`);

    const multibyte = 'é'.repeat(128);
    expect(multibyte.length).toBeLessThan(MAX_MANAGED_AGENT_NAME_BYTES);
    expect(Buffer.byteLength(multibyte, 'utf8')).toBe(256);
    expect(errorCode(yaml().replace('researcher', multibyte)).code).toBe(
      'invalid_name',
    );
    expect(
      parseManagedAgentPackage(yaml().replace('researcher', 'é'.repeat(127)))
        .normalizedName,
    ).toBe('é'.repeat(127));
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

  it('rejects a scalar exceeding the bound inside a YAML pair value', () => {
    const error = errorCode(
      yaml().replace(
        'Be concise and cite sources.',
        'x'.repeat(MAX_SCALAR_LENGTH + 1),
      ),
    );
    expect(error.code).toBe('scalar_limit');
  });

  it('rejects excessive nested YAML AST depth with a stable code', () => {
    let source = 'a:';
    for (let index = 0; index < MAX_AST_DEPTH + 2; index += 1)
      source += `\n${' '.repeat((index + 1) * 2)}a:`;
    source += `\n${' '.repeat((MAX_AST_DEPTH + 3) * 2)}value`;
    expect(errorCode(source).code).toBe('complexity_limit');
  });

  it('preserves valid empty tool and skill sequences', () => {
    const value = parseManagedAgentPackage(
      yaml()
        .replace(
          '  tools:\n    - ref: web-search\n      kind: tool',
          '  tools: []',
        )
        .replace('  skills:\n    - ref: research', '  skills: []'),
    ).package;
    expect(value.spec.tools).toEqual([]);
    expect(value.spec.skills).toEqual([]);
  });

  it('accepts ordinary RE2 schema patterns and retains the original source', () => {
    for (const pattern of ['^(foo|bar)$', 'a?b?', '^[a-z]+$', '^a{2,4}$']) {
      const source = yaml().replace(
        'type: string, min: 1, additionalProperties: false',
        `type: string, min: 1, pattern: "${pattern}", additionalProperties: false`,
      );
      const parsed = parseManagedAgentPackage(source);
      expect(parsed.package.spec.input.schema.properties?.topic?.pattern).toBe(
        pattern,
      );
      expect(parsed.canonicalJson).toContain(pattern);
    }
    const a = parseManagedAgentPackage(
      yaml().replace(
        'type: string, min: 1, additionalProperties: false',
        'type: string, pattern: "^(foo|bar)$", min: 1, additionalProperties: false',
      ),
    );
    const b = parseManagedAgentPackage(
      yaml().replace(
        'type: string, min: 1, additionalProperties: false',
        'type: string, min: 1, pattern: "^(foo|bar)$", additionalProperties: false',
      ),
    );
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it('rejects inapplicable and nested unsupported schema fields', () => {
    const stringProperties = yaml().replace(
      'type: string, min: 1, additionalProperties: false',
      'type: string, properties: { x: { $ref: nope } }, additionalProperties: false',
    );
    expect(errorCode(stringProperties).code).toBe('unknown_schema_field');
    const arrayProperties = yaml().replace(
      'type: string, min: 1, additionalProperties: false',
      'type: array, properties: { x: { type: string, additionalProperties: false } }, additionalProperties: false',
    );
    expect(errorCode(arrayProperties).code).toBe('unknown_schema_field');
  });

  it('keeps secret-bearing schema property names out of public errors', () => {
    const source = yaml()
      .replace(
        'topic: { type: string, min: 1, additionalProperties: false }',
        'passwordToken: { type: string, properties: { x: { $ref: secret-value } }, additionalProperties: false }',
      )
      .replace('input.topic', 'input.passwordToken');
    const error = errorCode(source);
    expect(error.code).toBe('unknown_schema_field');
    expect(JSON.stringify(error)).not.toContain('passwordToken');
    expect(JSON.stringify(error)).not.toContain('secret-value');
  });

  it('rejects tags and anchors below YAML pair descendants', () => {
    for (const replacement of [
      'topic: !!str { type: string, additionalProperties: false }',
      'topic: &schema { type: string, additionalProperties: false }',
    ]) {
      expect(() =>
        parseManagedAgentPackage(
          yaml().replace(
            'topic: { type: string, min: 1, additionalProperties: false }',
            replacement,
          ),
        ),
      ).toThrow();
    }
  });

  it('does not let the rejection helper accept its own sentinel', () => {
    expect(() => errorCode(yaml())).toThrow('expected rejection');
  });

  it('enforces model policy allowlists and forbids concrete model selection', () => {
    expect(() =>
      parseManagedAgentPackage(
        yaml().replace(BUILT_IN_MODEL_POLICY_REFS[0], 'paid'),
      ),
    ).toThrow();
    expect(() =>
      parseManagedAgentPackage(
        yaml().replace(BUILT_IN_MODEL_POLICY_REFS[0], 'gpt-5'),
      ),
    ).toThrow();
    const parser = parseManagedAgentPackage as unknown as (
      source: string,
      options: { allowedModelPolicyRefs: string[] },
    ) => unknown;
    expect(() =>
      parser(yaml().replace(BUILT_IN_MODEL_POLICY_REFS[0], 'gpt-5'), {
        allowedModelPolicyRefs: ['gpt-5'],
      }),
    ).toThrow();
    expect(() => parseManagedAgentPackage(yaml('  model: gpt-5'))).toThrow();
  });

  it('cannot widen the built-in model policy allowlist through runtime mutation', () => {
    const attemptedMutation = BUILT_IN_MODEL_POLICY_REFS as unknown as string[];
    try {
      attemptedMutation.push('gpt-5');
      attemptedMutation[0] = 'gpt-5';
    } catch {
      // Frozen exports reject mutation in strict mode.
    }
    expect(() =>
      parseManagedAgentPackage(yaml().replace('free-only', 'gpt-5')),
    ).toThrow();
  });

  it('does not expose unknown or duplicate attacker-controlled keys or values', () => {
    const unknownKey = 'passwordToken';
    const unknownValue = 'unknown-secret-value';
    const duplicateKey = 'credentialToken';
    const duplicateValue = 'duplicate-secret-value';
    for (const source of [
      yaml().replace(
        '  description:',
        `  ${unknownKey}: ${unknownValue}\n  description:`,
      ),
      yaml().replace(
        '  description: Researches a topic',
        `  ${duplicateKey}: first\n  ${duplicateKey}: ${duplicateValue}\n  description: Researches a topic`,
      ),
    ]) {
      const error = errorCode(source);
      expect(
        JSON.stringify({
          code: error.code,
          path: error.path,
          message: (error as Error).message,
        }),
      ).not.toContain(unknownKey);
      expect(
        JSON.stringify({
          code: error.code,
          path: error.path,
          message: (error as Error).message,
        }),
      ).not.toContain(duplicateKey);
      expect(JSON.stringify(error)).not.toContain(unknownValue);
      expect(JSON.stringify(error)).not.toContain(duplicateValue);
    }
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
