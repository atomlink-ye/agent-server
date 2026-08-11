import { describe, expect, it } from 'vitest';

import {
  ProductRunTraceResponseSchema,
  ProductWorkRunResponseSchema,
} from './index.js';
import {
  compareProductProjectionLineage,
  flattenProductProjectionSchemaPaths,
  scanProductProjectionVocabulary,
  validateProductProjectionLineageManifest,
} from '../../../scripts/ci/check-product-projection-lineage.js';
import { PRODUCT_PROJECTION_LINEAGE_MANIFEST } from './lineage-manifest.js';

const vocabulary = {
  technicalIdContainer: 'source_refs',
  allowedSourceRefKeys: [
    'root_task_id',
    'team_run_id',
    'team_member_run_id',
    'task_id',
    'run_id',
    'team_message_id',
  ],
  forbiddenProductIdentityKeys: [
    'root_task_id',
    'team_run_id',
    'team_member_run_id',
    'task_id',
    'run_id',
  ],
  forbiddenLeafPrefixes: [
    'root_task',
    'team_run',
    'team_member_run',
    'team_version',
    'compiled_',
    'node_execution',
  ],
};

describe('S8 product projection lineage', () => {
  it('flattens real Zod schemas with variant and array paths', () => {
    const workPaths = flattenProductProjectionSchemaPaths(
      ProductWorkRunResponseSchema,
      'work_run_response',
    );
    const tracePaths = flattenProductProjectionSchemaPaths(
      ProductRunTraceResponseSchema,
      'run_trace_response',
    );

    expect(workPaths).toContain('work_run_response.success::work_run.id');
    expect(workPaths).toContain(
      'work_run_response.not_found::work_items[].attempts[].id',
    );
    expect(workPaths).toContain('work_run_response.error::error.code');
    expect(tracePaths).toContain(
      'run_trace_response.success::edges[]{kind=feedback}.reviewer_actor_id',
    );
    expect(tracePaths).not.toContain(
      'run_trace_response.success::work.archived_at.null',
    );
  });

  it('matches the authored manifest exactly and passes vocabulary policy', () => {
    const result = compareProductProjectionLineage(
      undefined,
      undefined,
      vocabulary,
    );
    expect(result).toMatchObject({
      schemaPaths: 298,
      manifestKeys: 298,
      missing: [],
      extra: [],
      forbiddenPrefixHits: [],
      forbiddenIdentityHits: [],
      forbiddenSourceRefHits: [],
    });
  });

  it('fails closed for identity fields outside source_refs', () => {
    const result = scanProductProjectionVocabulary(
      ['work_run_response.success::work.run_id'],
      vocabulary,
    );
    expect(result.forbiddenIdentityHits).toEqual([
      'work_run_response.success::work.run_id',
    ]);
    expect(
      scanProductProjectionVocabulary(
        ['work_run_response.success::work.source_refs.run_id'],
        vocabulary,
      ),
    ).toMatchObject({
      forbiddenPrefixHits: [],
      forbiddenIdentityHits: [],
      forbiddenSourceRefHits: [],
    });
    expect(
      scanProductProjectionVocabulary(
        ['work_run_response.success::work.source_refs.secret_id'],
        vocabulary,
      ).forbiddenSourceRefHits,
    ).toEqual(['work_run_response.success::work.source_refs.secret_id']);
  });

  it('keeps every manifest value within the machine-readable categories', () => {
    for (const value of Object.values(PRODUCT_PROJECTION_LINEAGE_MANIFEST)) {
      expect(['column', 'source_ref', 'derivation']).toContain(value.kind);
      if (value.kind === 'derivation') {
        expect(value.name).toBeTruthy();
        expect(value.formula).toBeTruthy();
        expect(Array.isArray(value.inputs)).toBe(true);
      }
    }
    expect(validateProductProjectionLineageManifest()).toEqual({
      invalidDerivations: [],
      invalidEntries: [],
    });
    expect(
      PRODUCT_PROJECTION_LINEAGE_MANIFEST[
        'work_run_response.not_found::work_items[].id'
      ],
    ).toMatchObject({
      kind: 'derivation',
      name: 'not_found_empty_collection_v1',
    });
  });

  it('records derived fields against their durable JSON or text inputs', () => {
    const manifest = PRODUCT_PROJECTION_LINEAGE_MANIFEST;
    const expectedDerivations = {
      'run_trace_response.success::runs[].provider': {
        name: 'run_runtime_field_v1',
        formula: "json_extract(runtime, '$.provider')",
        inputs: ['runs.runtime'],
      },
      'run_trace_response.success::runs[].model': {
        name: 'run_runtime_field_v1',
        formula: "json_extract(runtime, '$.model')",
        inputs: ['runs.runtime'],
      },
      'run_trace_response.success::runs[].error_code': {
        name: 'run_error_code_v1',
        formula: "json_extract(error, '$.code')",
        inputs: ['runs.error'],
      },
      'run_trace_response.success::runs[].result_capture_status': {
        name: 'redaction_capture_status_v1',
        formula: 'presence_to_redaction_status',
        inputs: ['runs.result'],
      },
      'run_trace_response.success::events[].payload_capture_status': {
        name: 'redaction_capture_status_v1',
        formula: 'presence_to_redaction_status',
        inputs: ['run_events.payload'],
      },
      'work_run_response.success::messages[].summary_capture_status': {
        name: 'summary_capture_status_v1',
        formula: 'capture_status(redacted_or_absent)',
        inputs: ['team_messages.body'],
      },
      'work_run_response.success::work_items[].attempts[].feedback_capture_status': {
        name: 'redaction_capture_status_v1',
        formula: 'presence_to_redaction_status',
        inputs: ['team_work_item_attempts.feedback'],
      },
      'work_run_response.success::work_items[].attempts[].result_capture_status': {
        name: 'redaction_capture_status_v1',
        formula: 'presence_to_redaction_status',
        inputs: ['team_work_item_attempts.result_summary'],
      },
      'run_trace_response.success::edges[]{kind=feedback}.reviewer_actor_id': {
        name: 'feedback_reviewer_v1',
        formula:
          'join(requested_by_lead_task_id,tasks.id)->tasks.team_member_run_id',
        inputs: [
          'team_work_item_attempts.requested_by_lead_task_id',
          'tasks.id',
          'tasks.team_member_run_id',
        ],
      },
    } as const;

    for (const [path, expected] of Object.entries(expectedDerivations)) {
      expect(manifest[path as keyof typeof manifest]).toMatchObject({
        kind: 'derivation',
        ...expected,
      });
    }

    for (const [path, value] of Object.entries(manifest)) {
      if (value.kind === 'derivation' && !value.formula.startsWith('constant('))
        expect(value.inputs, path).not.toHaveLength(0);
    }

    for (const path of Object.keys(expectedDerivations))
      expect(manifest[path as keyof typeof manifest].kind).toBe('derivation');
  });
});
