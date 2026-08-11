export type ProductProjectionLineageEntry =
  | {
      readonly kind: 'column';
      readonly table: string;
      readonly column: string;
    }
  | {
      readonly kind: 'source_ref';
      readonly table: string;
      readonly column: string;
    }
  | {
      readonly kind: 'derivation';
      readonly name: string;
      readonly formula: string;
      readonly inputs: readonly string[];
    };

const SOURCE_REF_KEYS = [
  'root_task_id',
  'team_run_id',
  'team_member_run_id',
  'task_id',
  'run_id',
  'team_message_id',
] as const;

const WORK_FIELDS = [
  'archived_at',
  'created_at',
  'definition_id',
  'definition_version_id',
  'id',
  'origin',
  'tenant_id',
  'title',
  'updated_at',
  'workspace_id',
] as const;

const WORK_RUN_FIELDS = [
  'bound_at',
  'created_at',
  'definition_version_id',
  'expires_at',
  'id',
  'trigger_kind',
  'trigger_ref',
  'updated_at',
  'work_id',
] as const;

const ATTEMPT_FIELDS = [
  'attempt_no',
  'feedback_capture_status',
  'feedback_summary',
  'id',
  'result_capture_status',
  'result_summary',
  'status',
] as const;

const WORK_ITEM_FIELDS = [
  'actor_id',
  'dependency_ids[]',
  'description',
  'id',
  'status',
  'subject',
] as const;

const ACTOR_FIELDS = ['id', 'name'] as const;
const MESSAGE_FIELDS = [
  'id',
  'recipient_id',
  'recipient_name',
  'sender_id',
  'sender_name',
  'summary',
  'summary_capture_status',
] as const;

const RUN_FIELDS = [
  'created_at',
  'error_code',
  'model',
  'provider',
  'result_capture_status',
  'status',
  'updated_at',
] as const;

const EVENT_FIELDS = [
  'created_at',
  'payload_capture_status',
  'sequence',
  'type',
] as const;

const EDGE_FIELDS = {
  assignment: [
    'assignee_actor_id',
    'attempt_id',
    'guarantee',
    'kind',
    'source_created_at',
    'work_item_id',
  ],
  declared_dependency: [
    'dependent_work_item_id',
    'guarantee',
    'kind',
    'prerequisite_work_item_id',
    'source_created_at',
  ],
  feedback: [
    'attempt_id',
    'guarantee',
    'kind',
    'reviewer_actor_id',
    'source_created_at',
    'work_item_id',
  ],
  observed_message: [
    'attempt_id',
    'guarantee',
    'kind',
    'message_id',
    'recipient_actor_id',
    'sender_actor_id',
    'sequence',
    'source_created_at',
    'work_item_id',
  ],
} as const;

type EdgeKind = keyof typeof EDGE_FIELDS;

const withSourceRefs = (
  prefix: string,
  keys: readonly string[] = SOURCE_REF_KEYS,
): string[] => keys.map((key) => `${prefix}.source_refs.${key}`);

const identityPaths = [
  ...ACTOR_FIELDS.map((field) => `actors[].${field}`),
  ...withSourceRefs('actors[]'),
  ...MESSAGE_FIELDS.map((field) => `messages[].${field}`),
  ...withSourceRefs('messages[]'),
  ...WORK_ITEM_FIELDS.map((field) => `work_items[].${field}`),
  ...ATTEMPT_FIELDS.map((field) => `work_items[].attempts[].${field}`),
  ...withSourceRefs('work_items[]'),
  ...withSourceRefs('work_items[].attempts[]'),
] as const;

const basePaths = (includeIdentity: boolean): string[] => [
  ...(includeIdentity ? identityPaths : []),
  ...WORK_FIELDS.map((field) => `work.${field}`),
  ...WORK_RUN_FIELDS.map((field) => `work_run.${field}`),
];

const tracePaths = (includeIdentity: boolean): string[] => [
  ...basePaths(includeIdentity),
  ...RUN_FIELDS.map((field) => `runs[].${field}`),
  ...withSourceRefs('runs[]'),
  ...EVENT_FIELDS.map((field) => `events[].${field}`),
  ...withSourceRefs('events[]', ['root_task_id', 'task_id', 'run_id']),
  ...Object.entries(EDGE_FIELDS).flatMap(([kind, fields]) => [
    ...fields.map((field) => `edges[]{kind=${kind}}.${field}`),
    ...withSourceRefs(
      `edges[]{kind=${kind}}`,
      kind === 'observed_message'
        ? ['team_run_id', 'team_message_id']
        : kind === 'declared_dependency'
          ? ['team_run_id']
          : ['team_run_id', 'task_id'],
    ),
  ]),
];

const column = (
  table: string,
  columnName: string,
): ProductProjectionLineageEntry => ({
  kind: 'column',
  table,
  column: columnName,
});

const rule = (
  name: string,
  formula: string,
  inputs: readonly string[],
): ProductProjectionLineageEntry => ({
  kind: 'derivation',
  name,
  formula,
  inputs,
});

const sourceTableForPath = (path: string): string => {
  if (path.startsWith('work.')) return 'works';
  if (path.startsWith('work_run.')) return 'work_runs';
  if (path.startsWith('work_items[].attempts[].'))
    return 'team_work_item_attempts';
  if (path.startsWith('work_items[].')) return 'team_work_items';
  if (path.startsWith('actors[].')) return 'team_member_runs';
  if (path.startsWith('messages[].')) return 'team_messages';
  if (path.startsWith('runs[].')) return 'runs';
  if (path.startsWith('events[].')) return 'run_events';
  const edgeKind = path.match(/edges\[\]\{kind=([^}]+)\}/u)?.[1];
  if (edgeKind === 'declared_dependency') return 'team_work_item_dependencies';
  if (edgeKind === 'observed_message') return 'team_messages';
  if (edgeKind === 'assignment' || edgeKind === 'feedback')
    return 'team_work_item_attempts';
  throw new Error(`unmapped_lineage_path=${path}`);
};

const sourceRefTarget = (path: string): [string, string] | null => {
  const match = path.match(/^(.*)\.source_refs\.([^.[{]+)$/u);
  if (!match) return null;
  const entity = match[1]!;
  const key = match[2]!;
  if (entity.startsWith('actors[]')) {
    return key === 'root_task_id'
      ? ['team_runs', 'root_task_id']
      : key === 'team_run_id'
        ? ['team_runs', 'id']
        : key === 'team_member_run_id'
          ? ['team_member_runs', 'id']
          : null;
  }
  if (entity.startsWith('work_items[].attempts[]')) {
    return key === 'root_task_id'
      ? ['team_runs', 'root_task_id']
      : key === 'team_run_id'
        ? ['team_runs', 'id']
        : key === 'task_id'
          ? ['tasks', 'id']
          : null;
  }
  if (entity.startsWith('work_items[]')) {
    return key === 'root_task_id'
      ? ['team_runs', 'root_task_id']
      : key === 'team_run_id'
        ? ['team_runs', 'id']
        : null;
  }
  if (entity.startsWith('messages[]')) {
    return key === 'root_task_id'
      ? ['team_runs', 'root_task_id']
      : key === 'team_run_id'
        ? ['team_runs', 'id']
        : key === 'team_message_id'
          ? ['team_messages', 'id']
          : key === 'task_id'
            ? ['tasks', 'id']
            : null;
  }
  if (entity.startsWith('runs[]')) {
    return key === 'root_task_id'
      ? ['tasks', 'root_task_id']
      : key === 'task_id'
        ? ['tasks', 'id']
        : key === 'run_id'
          ? ['runs', 'id']
          : null;
  }
  if (entity.startsWith('events[]')) {
    return key === 'root_task_id'
      ? ['tasks', 'root_task_id']
      : key === 'run_id'
        ? ['runs', 'id']
        : null;
  }
  const edgeKind = entity.match(/edges\[\]\{kind=([^}]+)\}/u)?.[1];
  if (edgeKind === 'observed_message') {
    return key === 'team_run_id'
      ? ['team_messages', 'team_run_id']
      : key === 'team_message_id'
        ? ['team_messages', 'id']
        : null;
  }
  if (edgeKind === 'declared_dependency')
    return key === 'team_run_id'
      ? ['team_work_item_dependencies', 'team_run_id']
      : null;
  if (edgeKind === 'assignment' || edgeKind === 'feedback')
    return key === 'team_run_id'
      ? ['team_work_item_attempts', 'team_run_id']
      : key === 'task_id'
        ? ['tasks', 'id']
        : null;
  return null;
};

const directColumnName = (path: string): string | null => {
  const sourceRefMatch = path.match(/\.source_refs\.([^.[{]+)$/u);
  if (sourceRefMatch) return sourceRefMatch[1]!;
  if (path.endsWith('.dependency_ids[]')) return null;
  if (path.endsWith('.summary')) return null;
  if (path.endsWith('.summary_capture_status')) return null;
  if (path.endsWith('.sender_name') || path.endsWith('.recipient_name'))
    return null;
  if (path.endsWith('.feedback_summary') || path.endsWith('.result_summary'))
    return null;
  if (
    path.endsWith('.feedback_capture_status') ||
    path.endsWith('.result_capture_status')
  )
    return null;
  if (path.endsWith('.payload_capture_status')) return null;
  if (path.endsWith('.reviewer_actor_id')) return null;
  const edgeKind = path.match(/edges\[\]\{kind=([^}]+)\}\.([^.[{]+)$/u);
  if (edgeKind) {
    const [, kind, field] = edgeKind;
    if (field === 'source_created_at') return 'created_at';
    if (kind === 'assignment' && field === 'assignee_actor_id')
      return 'assignee_member_id';
    if (kind === 'feedback' && field === 'reviewer_actor_id') return null;
    if (kind === 'declared_dependency' && field === 'dependent_work_item_id')
      return 'work_item_id';
    if (kind === 'declared_dependency' && field === 'prerequisite_work_item_id')
      return 'depends_on_work_item_id';
    if (kind === 'observed_message' && field === 'message_id') return 'id';
    if (kind === 'observed_message' && field === 'sender_actor_id')
      return 'sender_member_run_id';
    if (kind === 'observed_message' && field === 'recipient_actor_id')
      return 'recipient_member_run_id';
    if (kind === 'observed_message' && field === 'work_item_id')
      return 'work_item_id';
    if (kind === 'observed_message' && field === 'attempt_id')
      return 'attempt_id';
    if (kind === 'observed_message' && field === 'sequence') return 'sequence';
    if (kind === 'assignment' && field === 'attempt_id') return 'id';
    if (kind === 'assignment' && field === 'work_item_id')
      return 'work_item_id';
    if (kind === 'feedback' && field === 'attempt_id') return 'id';
    if (kind === 'feedback' && field === 'work_item_id') return 'work_item_id';
    return null;
  }
  const pathWithoutArrays = path.replace(/\[\]/gu, '');
  const field = pathWithoutArrays.slice(pathWithoutArrays.lastIndexOf('.') + 1);
  if (path.startsWith('work_items[].') && field === 'actor_id')
    return 'owner_member_id';
  if (path.startsWith('messages[].') && field === 'sender_id')
    return 'sender_member_run_id';
  if (path.startsWith('messages[].') && field === 'recipient_id')
    return 'recipient_member_run_id';
  if (path.startsWith('work.') && field === 'definition_version_id')
    return 'current_definition_version_id';
  if (
    path.startsWith('work.') &&
    WORK_FIELDS.includes(field as (typeof WORK_FIELDS)[number])
  )
    return field;
  if (
    path.startsWith('work_run.') &&
    WORK_RUN_FIELDS.includes(field as (typeof WORK_RUN_FIELDS)[number])
  )
    return field;
  if (
    path.startsWith('work_items[].attempts[].') &&
    ATTEMPT_FIELDS.includes(field as (typeof ATTEMPT_FIELDS)[number])
  )
    return field;
  if (
    path.startsWith('work_items[].') &&
    WORK_ITEM_FIELDS.includes(field as (typeof WORK_ITEM_FIELDS)[number])
  )
    return field;
  if (
    path.startsWith('actors[].') &&
    ACTOR_FIELDS.includes(field as (typeof ACTOR_FIELDS)[number])
  )
    return field;
  if (
    path.startsWith('messages[].') &&
    MESSAGE_FIELDS.includes(field as (typeof MESSAGE_FIELDS)[number])
  )
    return field;
  if (
    path.startsWith('runs[].') &&
    RUN_FIELDS.includes(field as (typeof RUN_FIELDS)[number])
  )
    return field;
  if (
    path.startsWith('events[].') &&
    EVENT_FIELDS.includes(field as (typeof EVENT_FIELDS)[number])
  )
    return field;
  return null;
};

const derivation = (
  owner: string,
  variant: string,
  path: string,
): ProductProjectionLineageEntry => {
  const relativePath = path.slice(`${owner}.${variant}::`.length);
  if (
    relativePath === 'contract_status' ||
    relativePath.endsWith('.contract_status')
  )
    return rule('projection_contract_status_v1', 'constant(provisional)', []);
  if (
    relativePath === 'capture_status' ||
    relativePath.endsWith('.capture_status')
  )
    return rule(
      'capture_status_v1',
      variant === 'not_found' ? 'constant(not_found)' : 'constant(complete)',
      [],
    );
  if (
    relativePath.endsWith('.feedback_capture_status') ||
    relativePath.endsWith('.result_capture_status') ||
    relativePath.endsWith('.payload_capture_status')
  )
    return rule(
      'redaction_capture_status_v1',
      'presence_to_redaction_status',
      [],
    );
  if (variant === 'not_found' && relativePath.includes('[]'))
    return rule(
      'not_found_empty_collection_v1',
      'constant(empty_collection)',
      [],
    );
  if (relativePath.startsWith('error.'))
    return rule(
      relativePath === 'error.reason'
        ? 'projection_invariant_reason_v1'
        : 'route_error_mapping_v1',
      relativePath === 'error.reason'
        ? 'map_event_page_failure_reason'
        : `map_route_error_${relativePath.slice('error.'.length)}`,
      ['projection_failure'],
    );
  if (relativePath.endsWith('.dependency_ids[]'))
    return rule('dependency_ids_v1', 'collect(depends_on_work_item_id)', [
      'team_work_item_dependencies.depends_on_work_item_id',
    ]);
  if (
    relativePath.endsWith('.summary') ||
    relativePath.endsWith('.sender_name') ||
    relativePath.endsWith('.recipient_name') ||
    relativePath.endsWith('.feedback_summary') ||
    relativePath.endsWith('.result_summary') ||
    relativePath.endsWith('.reviewer_actor_id')
  )
    return rule(
      relativePath.endsWith('.reviewer_actor_id')
        ? 'feedback_reviewer_v1'
        : 'redacted_optional_text_v1',
      relativePath.endsWith('.reviewer_actor_id')
        ? 'lookup_reviewer_actor'
        : 'capture_to_null',
      relativePath.endsWith('.reviewer_actor_id')
        ? ['team_work_item_attempts.reviewer_member_id']
        : ['redaction_status'],
    );
  if (relativePath.endsWith('.summary_capture_status'))
    return rule(
      'summary_capture_status_v1',
      'capture_status(redacted_or_absent)',
      [],
    );
  const edgeKind = path.match(/edges\[\]\{kind=([^}]+)\}/u)?.[1];
  if (edgeKind && (path.endsWith('.kind') || path.endsWith('.guarantee')))
    return rule(
      `${edgeKind}_edge_${path.endsWith('.kind') ? 'kind' : 'guarantee'}_v1`,
      path.endsWith('.kind')
        ? `constant(${edgeKind})`
        : `constant(${edgeKind === 'observed_message' ? 'ordered_observation' : edgeKind === 'declared_dependency' ? 'declared_relation' : 'derived_relation'})`,
      [],
    );
  const table = sourceTableForPath(relativePath);
  const columnName = directColumnName(relativePath);
  if (!columnName) throw new Error(`unmapped_lineage_path=${relativePath}`);
  return column(table, columnName);
};

const manifestFor = (
  owner: 'work_run_response' | 'run_trace_response',
  variant: 'success' | 'not_found' | 'error',
  paths: readonly string[],
): Record<string, ProductProjectionLineageEntry> => {
  const prefix = `${owner}.${variant}::`;
  return Object.fromEntries(
    paths.map((path) => {
      const key = `${prefix}${path}`;
      const sourceRef = path.includes('.source_refs.');
      const value =
        variant !== 'not_found' && sourceRef
          ? (() => {
              const target = sourceRefTarget(path);
              return target
                ? ({
                    kind: 'source_ref',
                    table: target[0],
                    column: target[1],
                  } as const)
                : rule(
                    'optional_source_ref_not_emitted_v1',
                    'optional_source_ref_absent',
                    [path],
                  );
            })()
          : derivation(owner, variant, key);
      return [key, value];
    }),
  );
};

const workRunErrorPaths = [
  'contract_status',
  'error.code',
  'error.message',
  'error.reason',
];

/**
 * Provisional S8 lineage manifest. The path lists above are authored product
 * contract facts; they intentionally do not import or walk the Zod schemas.
 */
export const PRODUCT_PROJECTION_LINEAGE_MANIFEST = {
  ...manifestFor('work_run_response', 'success', [
    'capture_status',
    'contract_status',
    ...basePaths(true),
  ]),
  ...manifestFor('work_run_response', 'not_found', [
    'capture_status',
    'contract_status',
    ...identityPaths,
  ]),
  ...manifestFor('work_run_response', 'error', workRunErrorPaths),
  ...manifestFor('run_trace_response', 'success', [
    'capture_status',
    'contract_status',
    ...tracePaths(true),
  ]),
  ...manifestFor('run_trace_response', 'not_found', [
    'capture_status',
    'contract_status',
    ...tracePaths(false).filter(
      (path) => !path.startsWith('work.') && !path.startsWith('work_run.'),
    ),
  ]),
  ...manifestFor('run_trace_response', 'error', workRunErrorPaths),
} as const satisfies Record<string, ProductProjectionLineageEntry>;

export type ProductProjectionLineageManifest =
  typeof PRODUCT_PROJECTION_LINEAGE_MANIFEST;
