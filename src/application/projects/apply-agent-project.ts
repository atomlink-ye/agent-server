import { resolve } from 'node:path';
import type { NormalizedAgentProject } from '../../domain/projects/agent-project.js';
import type {
  AgentProjectLock,
  ResourceLock,
} from '../../domain/projects/agent-project-lock.js';
import type {
  ProjectControlPlane,
  PublishedResource,
} from './project-control-plane.js';
import { renderProjectAgent } from './render-project-agent.js';
import { renderProjectTeam } from './render-project-team.js';
import type { ProjectSkillRegistrar } from '../../infrastructure/filesystem/local-project-skill-registrar.js';
import type { AgentProjectLockStore } from '../../infrastructure/filesystem/local-agent-project-lock.js';
import { deterministicIdempotencyKey } from '../../adapters/http/agent-project-http-control-plane.js';
import {
  normalizeMemoryPath,
  sha256,
} from '../../domain/memory-api/memory-api.js';
import { parseManagedEnvironmentPackage } from '../../domain/environments/managed-environment-package.js';

export type ApplyOutcome = 'Create' | 'Publish' | 'Update' | 'Reuse' | 'NoOp';
export interface ApplyStepResult {
  readonly section: string;
  readonly ref: string;
  readonly outcome: ApplyOutcome;
  readonly id?: string;
  readonly fingerprint?: string;
}
export interface ApplyResult {
  readonly projectName: string;
  readonly completed: readonly ApplyStepResult[];
  readonly lock: AgentProjectLock;
}
export interface ApplyAgentProjectOptions {
  readonly project: NormalizedAgentProject;
  readonly controlPlane: ProjectControlPlane;
  readonly skillRegistrar: ProjectSkillRegistrar;
  readonly lockStore: AgentProjectLockStore;
  readonly projectRoot: string;
}

export type AgentProjectApplyErrorCode =
  | 'workspace_not_found'
  | 'workspace_name_mismatch'
  | 'stale_lock'
  | 'memory_store_ambiguous'
  | 'control_plane_invalid_response'
  | 'apply_failed';

export class AgentProjectApplyError extends Error {
  public readonly completed: readonly ApplyStepResult[];
  public constructor(
    public readonly code: AgentProjectApplyErrorCode,
    completed: readonly ApplyStepResult[],
  ) {
    super(code);
    this.name = 'AgentProjectApplyError';
    this.completed = Object.freeze(
      completed.map((step) => Object.freeze({ ...step })),
    );
  }
}

export async function applyAgentProject(
  options: ApplyAgentProjectOptions,
): Promise<ApplyResult> {
  const { project, controlPlane, skillRegistrar, lockStore } = options;
  const completed: ApplyStepResult[] = [];
  try {
    const priorLock = await lockStore.read();
    const sameProjectFingerprint =
      priorLock?.project.fingerprint === project.fingerprint;
    const workspace = await controlPlane.getWorkspace();
    if (!workspace) throw new Error('workspace_not_found');
    if (workspace.name !== project.manifest.spec.workspace.name)
      throw new Error('workspace_name_mismatch');

    const toolProfiles = [...project.toolProfiles.entries()].sort(([a], [b]) =>
      cmp(a, b),
    );
    for (const [ref, value] of toolProfiles)
      completed.push({
        section: 'ToolProfiles',
        ref,
        outcome: 'NoOp',
        fingerprint: value.sourceFingerprint,
      });
    const skillLocks: Array<AgentProjectLock['skills'][number]> = [];
    for (const [ref, skill] of [...project.skills.entries()].sort(([a], [b]) =>
      cmp(a, b),
    )) {
      const name = ref.slice('skill://'.length);
      const requiredTools = expandTools(project, skill.requiredTools);
      const result = await skillRegistrar.register({
        ref: `project/${project.manifest.metadata.name}/${name}`,
        name,
        sourceRoot: resolve(options.projectRoot, skill.directory),
        requiredToolRefs: requiredTools,
        expectedDigest: skill.digest,
      });
      if (result.digest !== skill.digest)
        throw new Error('skill_digest_mismatch');
      completed.push({
        section: 'Skills',
        ref,
        outcome: result.changed ? 'Create' : 'Reuse',
        fingerprint: `sha256:${result.digest}`,
      });
      skillLocks.push({
        ref,
        catalogRef: result.ref,
        digest: result.digest,
        requiredTools,
      });
    }
    const environments: ResourceLock[] = [];
    for (const [ref, value] of [...project.environments.entries()].sort(
      ([a], [b]) => cmp(a, b),
    )) {
      const validation = await controlPlane.validateEnvironment(value.source);
      if (validation.fingerprint !== parseFingerprint(value.source))
        throw new Error('environment_fingerprint_mismatch');
      const imported = await controlPlane.importEnvironment(
        value.source,
        key(
          'import-environment',
          project.manifest.metadata.name,
          ref,
          validation.fingerprint,
        ),
      );
      if (imported.status === 'draft' && imported.outcome === 'created')
        completed.push({
          section: 'Environments',
          ref,
          outcome: 'Create',
          id: imported.versionId,
        });
      if (sameProjectFingerprint)
        assertPriorResource(
          priorLock,
          'environments',
          ref,
          value.sourceFingerprint,
          validation.fingerprint,
          imported,
        );
      const published = await controlPlane.publishEnvironment(
        imported.versionId,
        key(
          'publish-environment',
          project.manifest.metadata.name,
          ref,
          validation.fingerprint,
        ),
      );
      environments.push(
        resource(
          ref,
          value.sourceFingerprint,
          validation.fingerprint,
          published,
        ),
      );
      completed.push({
        section: 'Environments',
        ref,
        outcome: imported.status === 'published' ? 'Reuse' : 'Publish',
        id: published.versionId,
        fingerprint: validation.fingerprint,
      });
    }
    const agents: ResourceLock[] = [];
    for (const [ref, value] of [...project.agents.entries()].sort(([a], [b]) =>
      cmp(a, b),
    )) {
      const rendered = renderProjectAgent({
        project,
        agent: ref as `agent://${string}`,
      });
      const validation = await controlPlane.validateAgent(rendered.source);
      if (validation.fingerprint !== rendered.nativeFingerprint)
        throw new Error('agent_fingerprint_mismatch');
      const imported = await controlPlane.importAgent(
        rendered.source,
        key(
          'import-agent',
          project.manifest.metadata.name,
          ref,
          rendered.nativeFingerprint,
        ),
      );
      if (imported.status === 'draft' && imported.outcome === 'created')
        completed.push({
          section: 'Agents',
          ref,
          outcome: 'Create',
          id: imported.versionId,
        });
      if (sameProjectFingerprint)
        assertPriorResource(
          priorLock,
          'agents',
          ref,
          value.sourceFingerprint,
          rendered.nativeFingerprint,
          imported,
        );
      const published = await controlPlane.publishAgent(
        imported.versionId,
        key(
          'publish-agent',
          project.manifest.metadata.name,
          ref,
          rendered.nativeFingerprint,
        ),
      );
      agents.push(
        resource(
          ref,
          value.sourceFingerprint,
          rendered.nativeFingerprint,
          published,
        ),
      );
      completed.push({
        section: 'Agents',
        ref,
        outcome: imported.status === 'published' ? 'Reuse' : 'Publish',
        id: published.versionId,
        fingerprint: validation.fingerprint,
      });
    }
    const envTargets = new Map(environments.map((x) => [x.ref, x.versionId]));
    const agentTargets = new Map(agents.map((x) => [x.ref, x.versionId]));
    const teams: ResourceLock[] = [];
    for (const [ref, value] of [...project.teams.entries()].sort(([a], [b]) =>
      cmp(a, b),
    )) {
      const rendered = renderProjectTeam({
        project,
        team: ref as `team://${string}`,
        mode: 'apply',
        targets: new Map([...envTargets, ...agentTargets]),
      });
      const validation = await controlPlane.validateTeam(rendered.source);
      if (validation.fingerprint !== rendered.nativeFingerprint)
        throw new Error('team_fingerprint_mismatch');
      const imported = await controlPlane.importTeam(
        rendered.source,
        key(
          'import-team',
          project.manifest.metadata.name,
          ref,
          rendered.nativeFingerprint,
        ),
      );
      if (imported.status === 'draft' && imported.outcome === 'created')
        completed.push({
          section: 'Teams',
          ref,
          outcome: 'Create',
          id: imported.versionId,
        });
      if (sameProjectFingerprint)
        assertPriorResource(
          priorLock,
          'teams',
          ref,
          value.sourceFingerprint,
          rendered.nativeFingerprint,
          imported,
        );
      const published = await controlPlane.publishTeam(
        imported.versionId,
        key(
          'publish-team',
          project.manifest.metadata.name,
          ref,
          rendered.nativeFingerprint,
        ),
      );
      teams.push(
        resource(
          ref,
          value.sourceFingerprint,
          rendered.nativeFingerprint,
          published,
        ),
      );
      completed.push({
        section: 'Teams',
        ref,
        outcome: imported.status === 'published' ? 'Reuse' : 'Publish',
        id: published.versionId,
        fingerprint: validation.fingerprint,
      });
    }
    const memoryStores: Array<AgentProjectLock['memoryStores'][number]> = [];
    for (const [ref, spec] of [...project.memoryStores.entries()].sort(
      ([a], [b]) => cmp(a, b),
    )) {
      const prior = priorLock?.memoryStores.find((item) => item.ref === ref);
      if (sameProjectFingerprint && !prior) throw new Error('stale_lock');
      const priorStore = prior
        ? await controlPlane.getMemoryStore(prior.id)
        : null;
      if (prior && (!priorStore || priorStore.name !== prior.name))
        throw new Error('stale_lock');
      if (priorStore && priorStore.owner.workspaceId !== workspace.id)
        throw new Error('memory_store_workspace_mismatch');
      const stores = await controlPlane.listMemoryStores(workspace.id);
      const matches = stores.filter((store) => store.name === spec.name);
      if (matches.length > 1) throw new Error('memory_store_ambiguous');
      if (
        priorStore &&
        (matches.length !== 1 || matches[0]!.id !== priorStore.id)
      )
        throw new Error('stale_lock');
      const store =
        matches[0] ??
        (await controlPlane.createMemoryStore({
          workspaceId: workspace.id,
          name: spec.name,
          ...(spec.description === undefined
            ? {}
            : { description: spec.description }),
        }));
      if (store.description !== (spec.description ?? null))
        throw new Error('memory_store_description_mismatch');
      completed.push({
        section: 'MemoryStores',
        ref,
        outcome: matches[0] ? 'Reuse' : 'Create',
        id: store.id,
      });
      const seeds: Array<
        AgentProjectLock['memoryStores'][number]['seeds'][number]
      > = [];
      for (const seed of [...spec.seeds].sort((a, b) => cmp(a.path, b.path))) {
        const path = normalizeMemoryPath(seed.path);
        const content = seed.source;
        if (`sha256:${sha256(content)}` !== seed.sourceFingerprint)
          throw new Error('memory_seed_fingerprint_mismatch');
        const current = (await controlPlane.listMemories(store.id)).find(
          (item) => item.path === path,
        );
        const priorSeed = sameProjectFingerprint
          ? priorLock?.memoryStores
              .find((item) => item.ref === ref)
              ?.seeds.find((item) => item.path === path)
          : undefined;
        if (sameProjectFingerprint && !priorSeed) throw new Error('stale_lock');
        if (
          sameProjectFingerprint &&
          priorSeed &&
          (!current ||
            current.id !== priorSeed.memoryId ||
            current.current.id !== priorSeed.memoryVersionId ||
            current.current.contentSha256 !== priorSeed.contentSha256)
        )
          throw new Error('stale_lock');
        let memory = current;
        let outcome: ApplyOutcome;
        if (!memory) {
          memory = await controlPlane.createMemory({
            storeId: store.id,
            path,
            content,
          });
          outcome = 'Create';
        } else if (memory.current.contentSha256 === sha256(content))
          outcome = 'NoOp';
        else {
          memory = await controlPlane.updateMemory({
            storeId: store.id,
            memoryId: memory.id,
            content,
            expectedSha256: memory.current.contentSha256,
          });
          outcome = 'Update';
        }
        completed.push({
          section: 'MemorySeeds',
          ref: `${ref}/${path}`,
          outcome,
          id: memory.id,
          fingerprint: `sha256:${sha256(content)}`,
        });
        seeds.push({
          path,
          contentSha256: memory.current.contentSha256,
          memoryId: memory.id,
          memoryVersionId: memory.current.id,
        });
      }
      memoryStores.push({ ref, id: store.id, name: store.name, seeds });
    }
    const entrypoints = project.entrypoints
      .slice()
      .sort(cmp)
      .map((ref) => ({
        ref,
        teamVersionId: teams.find((team) => team.ref === ref)!.versionId,
      }));
    const lock: AgentProjectLock = {
      apiVersion: 'agent-server/v1alpha1',
      kind: 'AgentProjectLock',
      project: {
        name: project.manifest.metadata.name,
        fingerprint: project.fingerprint,
      },
      workspace: {
        ref: project.workspace,
        id: workspace.id,
        name: workspace.name,
      },
      toolProfiles: toolProfiles.map(([ref, value]) => ({
        ref,
        sourceFingerprint: value.sourceFingerprint,
        tools: value.profile.spec.tools.map((tool) => tool.ref).sort(cmp),
      })),
      skills: skillLocks.slice().sort((a, b) => cmp(a.ref, b.ref)),
      environments: environments.slice().sort((a, b) => cmp(a.ref, b.ref)),
      agents: agents.slice().sort((a, b) => cmp(a.ref, b.ref)),
      teams: teams.slice().sort((a, b) => cmp(a.ref, b.ref)),
      memoryStores: memoryStores.slice().sort((a, b) => cmp(a.ref, b.ref)),
      entrypoints,
    };
    if (
      priorLock &&
      priorLock.project.fingerprint === project.fingerprint &&
      JSON.stringify(sortForCompare(priorLock)) !==
        JSON.stringify(sortForCompare(lock))
    )
      throw new Error('stale_lock');
    const lockWrite = await lockStore.write(lock);
    completed.push({
      section: 'Lock',
      ref: 'agent-project.lock.json',
      outcome: lockWrite.outcome,
      fingerprint: lockWrite.fingerprint,
    });
    return { projectName: project.manifest.metadata.name, completed, lock };
  } catch (error) {
    if (error instanceof AgentProjectApplyError) throw error;
    const code =
      error instanceof Error && safeApplyCode(error.message)
        ? safeApplyCode(error.message)!
        : 'apply_failed';
    throw new AgentProjectApplyError(code, completed);
  }
}
function resource(
  ref: string,
  sourceFingerprint: string,
  appliedFingerprint: string,
  value: PublishedResource,
): ResourceLock {
  return {
    ref,
    sourceFingerprint: sourceFingerprint as any,
    appliedFingerprint: appliedFingerprint as any,
    definitionId: value.definitionId,
    versionId: value.versionId,
  };
}
function assertPriorResource(
  lock: AgentProjectLock | null,
  section: 'environments' | 'agents' | 'teams',
  ref: string,
  sourceFingerprint: string,
  appliedFingerprint: string,
  imported: PublishedResource,
): void {
  const prior = lock?.[section].find((item) => item.ref === ref);
  if (
    !prior ||
    prior.sourceFingerprint !== sourceFingerprint ||
    prior.definitionId !== imported.definitionId ||
    prior.versionId !== imported.versionId ||
    prior.appliedFingerprint !== appliedFingerprint
  )
    throw new Error('stale_lock');
}
function expandTools(
  project: NormalizedAgentProject,
  refs: readonly string[],
): string[] {
  const result = new Set<string>();
  for (const ref of refs) {
    if (ref.startsWith('tool-profile://'))
      for (const tool of project.toolProfiles.get(ref as any)!.profile.spec
        .tools)
        result.add(tool.ref);
    else result.add(ref);
  }
  return [...result].sort(cmp);
}
function key(
  operation: string,
  project: string,
  ref: string,
  fingerprint: string,
): string {
  return deterministicIdempotencyKey(operation, project, ref, fingerprint);
}
function sortForCompare(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForCompare);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => cmp(a, b))
        .map(([key, child]) => [key, sortForCompare(child)]),
    );
  }
  return value;
}
function parseFingerprint(source: string): string {
  return parseManagedEnvironmentPackage(source).fingerprint;
}
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function safeApplyCode(message: string): AgentProjectApplyErrorCode | null {
  const allowed = new Set<AgentProjectApplyErrorCode>([
    'workspace_not_found',
    'workspace_name_mismatch',
    'stale_lock',
    'memory_store_ambiguous',
    'control_plane_invalid_response',
    'apply_failed',
  ]);
  return allowed.has(message as AgentProjectApplyErrorCode)
    ? (message as AgentProjectApplyErrorCode)
    : null;
}
