import { parseManagedEnvironmentPackage } from '../../domain/environments/managed-environment-package.js';
import type { NormalizedAgentProject } from '../../domain/projects/agent-project.js';
import type {
  ProjectPlan,
  ProjectPlanSection,
  ProjectPlanStep,
} from '../../domain/projects/project-plan.js';
import { renderProjectWorker } from './render-project-worker.js';
import { renderProjectTeam } from './render-project-team.js';
import type { Sha256Fingerprint } from '../../domain/projects/project-canonicalization.js';
import { MAX_COLLECTION_SIZE } from '../../domain/agents/managed-agent-yaml.js';
import { isSafeNativeRef } from '../../domain/projects/safe-ref.js';
import { SUPPORTED_MANAGED_AGENT_TOOL_REFS } from '../agents/built-in-skills.js';

export function planAgentProject(project: NormalizedAgentProject): ProjectPlan {
  for (const entrypoint of project.entrypoints)
    if (!project.teams.has(entrypoint))
      throw new Error('missing_entrypoint_team');
  if (!project.entrypoints.includes(project.defaultEntrypoint))
    throw new Error('default_entrypoint_not_declared');
  const steps: ProjectPlanStep[] = [
    {
      section: 'Workspace',
      name: project.workspace,
      action: 'resolve-workspace',
      dependencies: [],
    },
  ];
  addSorted(
    project.toolProfiles,
    'ToolProfiles',
    'validate-tool-profile',
    (ref, value) => {
      const tools = value.profile.spec.tools.map((tool) => tool.ref);
      if (tools.some((tool) => !SUPPORTED_MANAGED_AGENT_TOOL_REFS.has(tool)))
        throw new Error('unsupported_tool_reference');
      return {
        dependencies: tools.sort(compare),
        sourceFingerprint: value.sourceFingerprint,
      };
    },
  );
  addSorted(project.skills, 'Skills', 'register-skill', (ref, value) => {
    const requiredTools = expandSkillTools(project, value.requiredTools);
    return {
      dependencies: requiredTools.dependencies,
      sourceFingerprint: value.sourceFingerprint,
      metadata: { digest: value.digest },
    };
  });
  addSorted(
    project.environments,
    'Environments',
    'import/publish-environment',
    (ref, value) => ({
      dependencies: [],
      sourceFingerprint: value.sourceFingerprint,
      validationFingerprint: parseManagedEnvironmentPackage(value.source)
        .fingerprint as Sha256Fingerprint,
    }),
  );
  addSorted(
    project.workers,
    'Workers',
    'import/publish-worker',
    (ref, value) => {
      const rendered = renderProjectWorker({
        project,
        worker: ref as `worker://${string}`,
      });
      return {
        dependencies: rendered.dependencies,
        sourceFingerprint: rendered.sourceFingerprint,
        validationFingerprint: rendered.nativeFingerprint,
      };
    },
  );
  addSorted(project.teams, 'Teams', 'import/publish-team', (ref) => {
    const rendered = renderProjectTeam({
      project,
      team: ref as `team://${string}`,
      mode: 'plan',
    });
    return {
      dependencies: rendered.dependencies,
      sourceFingerprint: rendered.sourceFingerprint,
      validationFingerprint: rendered.nativeFingerprint,
    };
  });
  addSorted(
    project.memoryStores,
    'MemoryStores',
    'ensure-memory-store',
    (ref, value) => ({
      dependencies: [project.workspace],
      metadata: { name: value.name },
    }),
  );
  for (const [ref, store] of [...project.memoryStores.entries()].sort(
    ([a], [b]) => compare(a, b),
  ))
    for (const seed of [...store.seeds].sort((a, b) => compare(a.path, b.path)))
      steps.push({
        section: 'MemorySeeds',
        name: `${ref}/${seed.path}`,
        action: 'ensure-memory-seed',
        dependencies: [ref],
        sourceFingerprint: seed.sourceFingerprint,
      });
  for (const ref of [...project.entrypoints].sort(compare))
    steps.push({
      section: 'Entrypoints',
      name: ref,
      action: 'bind-entrypoint',
      dependencies: [ref],
    });
  return {
    apiVersion: 'agent-server/v1alpha1',
    kind: 'ProjectPlan',
    projectName: project.manifest.metadata.name,
    projectFingerprint: project.fingerprint,
    workspace: project.workspace,
    steps,
  };

  function addSorted<T>(
    map: ReadonlyMap<string, T>,
    section: ProjectPlanSection,
    action: ProjectPlanStep['action'],
    describe: (
      ref: string,
      value: T,
    ) => Omit<ProjectPlanStep, 'section' | 'name' | 'action'>,
  ): void {
    for (const [ref, value] of [...map.entries()].sort(([a], [b]) =>
      compare(a, b),
    ))
      steps.push({ section, name: ref, action, ...describe(ref, value) });
  }
}
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function expandSkillTools(
  project: NormalizedAgentProject,
  requiredTools: readonly string[],
): {
  readonly dependencies: readonly string[];
  readonly expanded: readonly string[];
} {
  const expanded = new Set<string>();
  const dependencies = new Set<string>();
  for (const required of requiredTools) {
    if (required.startsWith('tool-profile://')) {
      const profile = project.toolProfiles.get(
        required as `tool-profile://${string}`,
      );
      if (!profile) throw new Error('missing_tool_profile_reference');
      dependencies.add(required);
      for (const tool of profile.profile.spec.tools) add(tool.ref);
      continue;
    }
    if (
      required.includes('://') ||
      !isSafeNativeRef(required) ||
      !SUPPORTED_MANAGED_AGENT_TOOL_REFS.has(required)
    )
      throw new Error(
        !isSafeNativeRef(required) || required.includes('://')
          ? 'invalid_tool_reference'
          : 'unsupported_tool_reference',
      );
    dependencies.add(required);
    add(required);
  }
  return {
    dependencies: [...dependencies].sort(compare),
    expanded: [...expanded].sort(compare),
  };

  function add(tool: string): void {
    if (
      tool.includes('://') ||
      !isSafeNativeRef(tool) ||
      !SUPPORTED_MANAGED_AGENT_TOOL_REFS.has(tool)
    )
      throw new Error(
        !isSafeNativeRef(tool) || tool.includes('://')
          ? 'invalid_tool_reference'
          : 'unsupported_tool_reference',
      );
    if (expanded.has(tool))
      throw new Error('duplicate_required_tool_reference');
    expanded.add(tool);
    if (expanded.size > MAX_COLLECTION_SIZE)
      throw new Error('collection_limit');
  }
}
