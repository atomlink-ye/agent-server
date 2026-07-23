import { isMap, isPair, isScalar, isSeq, parseAllDocuments } from 'yaml';

export const MAX_SOURCE_BYTES = 64 * 1024;
export const MAX_AST_NODES = 500;
export const MAX_AST_DEPTH = 24;
export const MAX_COLLECTION_SIZE = 64;
export const MAX_SCALAR_LENGTH = 16 * 1024;

export class ManagedAgentYamlError extends Error {
  constructor(
    readonly code: string,
    readonly path = '$',
  ) {
    super(code);
  }
}

const fail = (code: string, path?: string): never => {
  throw new ManagedAgentYamlError(code, path);
};

function checkNode(
  node: unknown,
  path: string,
  depth: number,
  state: { nodes: number },
): void {
  if (node === null || node === undefined) return;
  if (typeof node !== 'object') fail('yaml_invalid', path);
  state.nodes += 1;
  if (state.nodes > MAX_AST_NODES || depth > MAX_AST_DEPTH)
    fail('complexity_limit');

  const candidate = node as { anchor?: unknown; tag?: unknown; type?: unknown };
  if (candidate.anchor || candidate.tag || candidate.type === 'ALIAS')
    fail('forbidden_yaml_feature');

  if (isPair(node)) {
    if (isScalar(node.key) && node.key.value === '<<')
      fail('forbidden_yaml_feature');
    checkNode(node.key, `${path}.key`, depth + 1, state);
    checkNode(node.value, `${path}.value`, depth + 1, state);
    return;
  }
  if (isMap(node)) {
    if (node.items.length > MAX_COLLECTION_SIZE) fail('collection_limit');
    node.items.forEach((item, index) =>
      checkNode(item, `${path}[${index}]`, depth + 1, state),
    );
    return;
  }
  if (isSeq(node)) {
    if (node.items.length > MAX_COLLECTION_SIZE) fail('collection_limit');
    node.items.forEach((item, index) =>
      checkNode(item, `${path}[${index}]`, depth + 1, state),
    );
    return;
  }
  if (isScalar(node)) {
    if (typeof node.value === 'string' && node.value.length > MAX_SCALAR_LENGTH)
      fail('scalar_limit');
    return;
  }
  fail('yaml_invalid', path);
}

export function parseManagedAgentYaml(source: string): unknown {
  if (typeof source !== 'string') fail('source_limit');
  if (Buffer.byteLength(source, 'utf8') > MAX_SOURCE_BYTES)
    fail('source_limit');
  if (/%YAML\s+1\.[01]|%TAG\s/i.test(source)) fail('forbidden_yaml_directive');

  try {
    const documents = parseAllDocuments(source, {
      version: '1.2',
      uniqueKeys: true,
      prettyErrors: false,
    });
    if (documents.length !== 1) fail('document_count');
    const document = documents[0]!;
    checkNode(document.contents, '$', 0, { nodes: 0 });
    if (document.errors.length || document.warnings.length)
      fail('yaml_invalid');
    return document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    if (error instanceof ManagedAgentYamlError) throw error;
    fail('yaml_invalid');
  }
}
