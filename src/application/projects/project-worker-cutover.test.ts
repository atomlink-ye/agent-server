import { describe, expect, it } from 'vitest';

import { parseManagedEnvironmentPackage } from '../../domain/environments/managed-environment-package.js';
import type { NormalizedAgentProject } from '../../domain/projects/agent-project.js';
import { validateAndCanonicalizeTeamPackage } from '../../domain/teams/managed-team-package.js';
import { parseWorkerForImport } from '../workers/validate-worker-package.js';
import { applyAgentProject } from './apply-agent-project.js';
import { planAgentProject } from './plan-agent-project.js';

const workerSource = `apiVersion: agent-server/v1alpha1
kind: Worker
metadata:
  name: Project Worker
spec:
  description: Formal project execution worker
  instructions: Complete the assigned formal Work.
  runtime: { provider: paseo, modelPolicyRef: free-only, mode: isolated }
  tools: []
  skills: []
  input: { schema: { type: object, additionalProperties: false, properties: {} }, prompt: hello }
  session: { invocation: fresh_per_invocation, followUps: queued, binding: reusable }
  memory: { policy: workspace_snapshot, proposalLimit: 0 }
  permissions: { network: none, filesystem: none }
  completion: { type: executable, command: done }
`;
const environmentSource = `apiVersion: agent-server/v1alpha1
kind: ManagedEnvironment
metadata: { name: Project Environment }
spec: { adapter: paseo, provider: opencode, modelPolicyRef: free-only, runtimeCellPolicy: per_runtime_session }
`;
const teamSource = `apiVersion: agent-server/v1alpha1
kind: ManagedTeam
metadata: { name: Project Team }
spec:
  environmentVersionId: environment://default
  lead: { name: Lead, workerVersionId: worker://executor }
  roster: [{ name: Member, workerVersionId: worker://executor }]
  coordination: { taskAssignment: lead_or_self_claim }
`;

describe('Project Team Worker producer cutover', () => {
  it('plans and applies published Worker pins into the rendered Team package', async () => {
    const project = projectFixture();
    const plan = planAgentProject(project);
    expect(plan.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          section: 'Workers',
          action: 'import/publish-worker',
          name: 'worker://executor',
        }),
        expect.objectContaining({
          section: 'Teams',
          dependencies: ['environment://default', 'worker://executor'],
        }),
      ]),
    );

    const calls: string[] = [];
    let renderedTeam = '';
    const result = await applyAgentProject({
      project,
      projectRoot: '/tmp/project-worker-cutover',
      skillRegistrar: {
        register: async () => {
          throw new Error('unused');
        },
      },
      lockStore: {
        read: async () => null,
        write: async (lock) => ({
          outcome: 'Create',
          fingerprint: lock.project.fingerprint,
        }),
      },
      controlPlane: {
        getWorkspace: async () => ({
          id: '00000000-0000-4000-8000-000000000001',
          name: 'Project Workspace',
        }),
        validateEnvironment: async (source) => ({
          fingerprint: parseManagedEnvironmentPackage(source).fingerprint,
        }),
        importEnvironment: async () =>
          resource('00000000-0000-4000-8000-000000000011'),
        publishEnvironment: async (versionId) =>
          resource(versionId, 'published'),
        validateWorker: async (source) => {
          calls.push('validateWorker');
          return { fingerprint: parseWorkerForImport(source).fingerprint };
        },
        importWorker: async () => {
          calls.push('importWorker');
          return resource('00000000-0000-4000-8000-000000000021');
        },
        publishWorker: async (versionId) => {
          calls.push('publishWorker');
          return resource(versionId, 'published');
        },
        validateTeam: async (source) => {
          renderedTeam = source;
          return {
            fingerprint: validateAndCanonicalizeTeamPackage(source).fingerprint,
          };
        },
        importTeam: async () =>
          resource('00000000-0000-4000-8000-000000000031'),
        publishTeam: async (versionId) => resource(versionId, 'published'),
        invokeTeam: async () => ({ taskId: 'unused', status: 'queued' }),
        getTask: async () => {
          throw new Error('unused');
        },
        getTaskTree: async () => {
          throw new Error('unused');
        },
        listMemoryStores: async () => [],
        getMemoryStore: async () => null,
        createMemoryStore: async () => {
          throw new Error('unused');
        },
        listMemories: async () => [],
        getMemory: async () => null,
        createMemory: async () => {
          throw new Error('unused');
        },
        updateMemory: async () => {
          throw new Error('unused');
        },
      },
    });

    expect(calls).toEqual(['validateWorker', 'importWorker', 'publishWorker']);
    expect(renderedTeam).toContain(
      'workerVersionId: 00000000-0000-4000-8000-000000000021',
    );
    expect(renderedTeam).not.toContain(`agent${'VersionId'}`);
    expect(result.lock.workers).toHaveLength(1);
    expect(result.lock.workers[0]?.versionId).toBe(
      '00000000-0000-4000-8000-000000000021',
    );
  });
});

function resource(versionId: string, status: 'draft' | 'published' = 'draft') {
  return {
    definitionId: '00000000-0000-4000-8000-000000000010',
    versionId,
    fingerprint: `sha256:${'a'.repeat(64)}`,
    status,
  } as const;
}

function projectFixture(): NormalizedAgentProject {
  const manifest = {
    apiVersion: 'agent-server/v1alpha1',
    kind: 'AgentProject',
    metadata: { name: 'project-worker-cutover' },
    spec: {
      workspace: { name: 'Project Workspace' },
      toolProfiles: {},
      skills: {},
      environments: { default: { file: 'environments/default.yaml' } },
      workers: { executor: { file: 'workers/executor.yaml' } },
      teams: { default: { file: 'teams/default.yaml' } },
      memoryStores: {},
      entrypoints: ['team://default'],
      defaultEntrypoint: 'team://default',
    },
  } as const;
  return {
    manifest,
    workspace: 'workspace://default',
    toolProfiles: new Map(),
    skills: new Map(),
    environments: new Map([
      [
        'environment://default',
        {
          name: 'default',
          path: 'environments/default.yaml',
          source: environmentSource,
          sourceFingerprint: `sha256:${'b'.repeat(64)}`,
        },
      ],
    ]),
    workers: new Map([
      [
        'worker://executor',
        {
          name: 'executor',
          path: 'workers/executor.yaml',
          source: workerSource,
          sourceFingerprint: `sha256:${'c'.repeat(64)}`,
        },
      ],
    ]),
    teams: new Map([
      [
        'team://default',
        {
          name: 'default',
          path: 'teams/default.yaml',
          source: teamSource,
          sourceFingerprint: `sha256:${'d'.repeat(64)}`,
        },
      ],
    ]),
    memoryStores: new Map(),
    entrypoints: ['team://default'],
    defaultEntrypoint: 'team://default',
    sourceTuples: [],
    canonicalManifest: '{}',
    fingerprint: `sha256:${'e'.repeat(64)}`,
  } as NormalizedAgentProject;
}
