import { stringify } from 'yaml';

import {
  AGENT_SERVER_DESCRIBE_WORKFLOW_TOOL_REF,
  AGENT_SERVER_LIST_AGENT_WORKFLOWS_TOOL_REF,
  AGENT_SERVER_PRODUCT_WORK_CREATE_TOOL_REF,
  AGENT_SERVER_PRODUCT_WORK_RUN_START_TOOL_REF,
  AGENT_SERVER_PRODUCT_WORK_READ_TOOL_REF,
  AGENT_SERVER_PRODUCT_WORK_RUN_READ_TOOL_REF,
  AGENT_SERVER_PRODUCT_WORK_RUN_TRANSCRIPT_TOOL_REF,
  AGENT_SERVER_WHISPER_OPEN_TOOL_REF,
  AGENT_SERVER_WHISPER_SEND_TOOL_REF,
  AGENT_SERVER_WORKSPACE_LIST_TOOL_REF,
  AGENT_SERVER_WORKSPACE_READ_TOOL_REF,
  AGENT_SERVER_WORKSPACE_WRITE_TOOL_REF,
  AGENT_SERVER_WORK_ITEM_CLAIM_TOOL_REF,
  AGENT_SERVER_WORK_ITEM_COMMENT_TOOL_REF,
  AGENT_SERVER_WORK_ITEM_STATUS_TOOL_REF,
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
  AGENT_SERVER_PRODUCT_WORK_READ_TOOL_REF,
  AGENT_SERVER_PRODUCT_WORK_RUN_READ_TOOL_REF,
  AGENT_SERVER_PRODUCT_WORK_RUN_TRANSCRIPT_TOOL_REF,
  AGENT_SERVER_LIST_AGENT_WORKFLOWS_TOOL_REF,
  AGENT_SERVER_DESCRIBE_WORKFLOW_TOOL_REF,
]);

/**
 * Every Coworker hired through the product form gets private coordination
 * with other Coworkers by default (Cumora's "any Coworker can whisper"
 * mental model) — this is a platform capability, not an opt-in the human
 * author configures per Coworker.
 */
const DEFAULT_COWORKER_COORDINATION_TOOLS = Object.freeze([
  AGENT_SERVER_WORK_ITEM_CLAIM_TOOL_REF,
  AGENT_SERVER_WORK_ITEM_COMMENT_TOOL_REF,
  AGENT_SERVER_WORK_ITEM_STATUS_TOOL_REF,
  AGENT_SERVER_WHISPER_OPEN_TOOL_REF,
  AGENT_SERVER_WHISPER_SEND_TOOL_REF,
  AGENT_SERVER_WORKSPACE_LIST_TOOL_REF,
  AGENT_SERVER_WORKSPACE_READ_TOOL_REF,
  AGENT_SERVER_WORKSPACE_WRITE_TOOL_REF,
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
    ...DEFAULT_COWORKER_COORDINATION_TOOLS,
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

/**
 * The Work Definition every Coworker is hired with.
 *
 * Work is the semantic this product is built around, and it has to hold for a
 * Coworker a real person just created, not only for seeded fixtures. Without
 * this, a freshly hired Coworker answers `list_agent_workflows` with an empty
 * list and has no Definition id to pass to `product_work_create`, so the whole
 * Work vocabulary is unreachable until somebody authors a Capability by hand.
 *
 * The Definition is compiled from what the person actually typed into the hire
 * form -- the Coworker's own role, summary and working style become the
 * inline Worker's instructions -- so the binding it produces is a Work this
 * Coworker can genuinely run, not a pointer at somebody else's fixture.
 */
export function compileCoworkerDefaultCapability(
  draft: CoworkerAuthoringDraft,
): { readonly source: string; readonly normalizedName: string } {
  const name = draft.name.trim();
  const role = draft.role.trim();
  const summary = draft.summary.trim();
  if (!name) throw new Error('Give this Coworker a name.');
  if (!role) throw new Error('Give this Coworker a role.');
  if (!summary)
    throw new Error('Describe what this Coworker should help with.');
  const normalizedName = `${capabilitySlug(name)}-assignment`;
  const workingStyle = draft.instructions?.trim();
  const worker = stringify(
    {
      apiVersion: 'agent-server/v1alpha1',
      kind: 'Worker',
      metadata: { name: `${normalizedName}-worker` },
      spec: {
        description: `${role} working a formal assignment for ${name}.`,
        instructions: [
          `You are ${name}, ${role}. ${summary}`,
          ...(workingStyle ? [`Working style:\n${workingStyle}`] : []),
          DEFAULT_CAPABILITY_COMPLETION_GUIDANCE,
        ].join('\n\n'),
        runtime: {
          provider: 'paseo',
          modelPolicyRef: draft.modelPolicyRef ?? 'free-only',
          mode: 'isolated',
        },
        tools: [],
        skills: [],
        input: {
          schema: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
          prompt:
            'Complete the assigned formal Work using the Work input and available context.',
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
    },
    YAML_BLOCK_OPTIONS,
  );
  const environment = stringify(
    {
      apiVersion: 'agent-server/v1alpha1',
      kind: 'ManagedEnvironment',
      metadata: { name: `${normalizedName}-environment` },
      spec: {
        adapter: 'paseo',
        provider: 'opencode',
        modelPolicyRef: draft.modelPolicyRef ?? 'free-only',
        runtimeCellPolicy: 'per_runtime_session',
      },
    },
    YAML_BLOCK_OPTIONS,
  );
  // `assignment` is deliberately optional. `product_work_run_start` starts a
  // WorkRun without an input payload, so a required field here would make the
  // Coworker's own two-step Work path fail input validation every time while
  // still validating at authoring time.
  const source = stringify(
    {
      apiVersion: 'agentserver.dev/v1alpha1',
      kind: 'WorkDefinition',
      metadata: {
        name: normalizedName,
        description: `Hand ${name} a formal assignment as ${role}. ${summary}`,
      },
      spec: {
        kind: 'single_worker',
        worker: { source: worker },
        environment: { source: environment },
        memory_version_ids: [],
        input_schema: {
          type: 'object',
          properties: {
            assignment: { type: 'string', max_length: 4_000 },
          },
          required: [],
          additional_properties: false,
        },
      },
    },
    YAML_BLOCK_OPTIONS,
  );
  return { source, normalizedName };
}

/**
 * Multi-line instructions are nested inside a Work Definition as a block
 * scalar. Left to wrap at the default line width, `yaml` emits them folded,
 * where its own line breaks become part of the string a Worker reads. Turning
 * wrapping off keeps every nested document byte-for-byte what was compiled.
 */
const YAML_BLOCK_OPTIONS = Object.freeze({ lineWidth: 0 });

const DEFAULT_CAPABILITY_COMPLETION_GUIDANCE =
  'Complete the assignment described in the Work input. When the Work is complete, stop using tools and return the final result directly. If data or permissions are unavailable, state the limitation and return the best bounded result available. Do not wait or retry indefinitely.';

/**
 * A Coworker name is unique per owner scope, so deriving the Definition name
 * from it keeps the default Capability unique too. Two names long enough to
 * share this prefix converge onto one Definition instead of colliding: the
 * second hire publishes its own version and binds that, so each Coworker
 * still runs its own instructions.
 *
 * The budget is the Work Definition name limit (80) minus the longest suffix
 * this module appends to it (`-assignment-environment`). A name with no
 * usable characters still has to produce a stable, legal Definition name.
 */
function capabilitySlug(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 48)
    .replace(/^-+|-+$/g, '');
  return normalized || `coworker-${stableHash(value)}`;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
