import { stringify } from 'yaml';

import {
  AGENT_SERVER_DESCRIBE_WORKFLOW_TOOL_REF,
  AGENT_SERVER_LIST_AGENT_WORKFLOWS_TOOL_REF,
  AGENT_SERVER_PRODUCT_WORK_CREATE_TOOL_REF,
  AGENT_SERVER_PRODUCT_WORK_RUN_START_TOOL_REF,
} from './built-in-skills.js';
import type { ModelPolicyRef } from '../../domain/agents/managed-agent-package.js';

export interface CoworkerAuthoringDraft {
  readonly name: string;
  readonly role: string;
  readonly summary: string;
  readonly instructions?: string | null;
  readonly modelPolicyRef?: ModelPolicyRef;
  readonly tools?: readonly string[];
  readonly skills?: readonly string[];
}

const DEFAULT_COWORKER_WORK_TOOLS = Object.freeze([
  AGENT_SERVER_PRODUCT_WORK_CREATE_TOOL_REF,
  AGENT_SERVER_PRODUCT_WORK_RUN_START_TOOL_REF,
  AGENT_SERVER_LIST_AGENT_WORKFLOWS_TOOL_REF,
  AGENT_SERVER_DESCRIBE_WORKFLOW_TOOL_REF,
]);

/** Friendly authoring projected onto the canonical immutable Agent package. */
export function compileCoworkerDraft(draft: CoworkerAuthoringDraft): string {
  if (!draft.name.trim()) throw new Error('Give this Coworker a name.');
  if (!draft.role.trim()) throw new Error('Give this Coworker a role.');
  if (!draft.summary.trim())
    throw new Error('Describe what this Coworker should help with.');
  if (draft.name.trim().length > 120 || draft.role.trim().length > 120)
    throw new Error('Coworker name and role must be 120 characters or fewer.');
  if (draft.summary.trim().length > 2_000)
    throw new Error('Coworker summary must be 2,000 characters or fewer.');
  if ((draft.instructions?.trim().length ?? 0) > 16_384)
    throw new Error('Working style must be 16,384 characters or fewer.');
  const identityInstruction = `You are ${draft.name.trim()}, ${draft.role.trim()}. ${draft.summary.trim()}`;
  const instructions = draft.instructions?.trim()
    ? `${identityInstruction}\n\nWorking style:\n${draft.instructions.trim()}`
    : identityInstruction;
  const tools = unique([
    ...DEFAULT_COWORKER_WORK_TOOLS,
    ...(draft.tools ?? []),
  ]).map((ref) => ({ ref, kind: 'tool' as const }));
  const skills = unique(draft.skills ?? []).map((ref) => ({ ref }));

  return stringify({
    apiVersion: 'agent-server/v1alpha1',
    kind: 'ManagedAgent',
    metadata: { name: draft.name.trim() },
    spec: {
      description: draft.summary.trim(),
      instructions,
      runtime: {
        provider: 'paseo',
        modelPolicyRef: draft.modelPolicyRef ?? 'free-only',
        mode: 'isolated',
      },
      tools,
      skills,
      input: {
        schema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        prompt:
          'Respond to the current Coworker conversation and use formal Work capabilities when appropriate.',
      },
      session: {
        invocation: 'fresh_per_invocation',
        followUps: 'queued',
        binding: 'reusable',
      },
      memory: { policy: 'workspace_snapshot', proposalLimit: 0 },
      permissions: { network: 'read_only', filesystem: 'workspace_read' },
      completion: { type: 'executable', command: 'done' },
    },
  });
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
