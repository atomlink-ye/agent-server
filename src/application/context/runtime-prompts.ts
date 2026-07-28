export const PLATFORM_RUNTIME_KERNEL =
  'Runtime contract: execute the supplied task input using the published agent instructions. Do not infer or access other session history.';

export function buildBootstrapPrompt(
  instructions?: string,
  skills: readonly {
    readonly ref: string;
    readonly body?: string;
    readonly delivery?: 'native_project';
  }[] = [],
): string {
  return [
    PLATFORM_RUNTIME_KERNEL,
    ...(instructions
      ? [`Published AgentVersion instructions:\n${instructions}`]
      : []),
    ...(skills.length
      ? [
          `Resolved Skills:\n${skills
            .map((skill) =>
              skill.delivery === 'native_project'
                ? `Native Skill available: ${skill.ref}.`
                : `Skill ${skill.ref}:\n${skill.body ?? ''}`,
            )
            .join('\n\n')}`,
        ]
      : []),
  ].join('\n\n');
}

export function buildTurnPrompt(input: {
  readonly taskInput: string;
  readonly memory?: string | null;
}): string {
  return input.memory
    ? `Pinned verified MEMORY.md:\n${input.memory}\n\nCurrent Task input:\n${input.taskInput}`
    : input.taskInput;
}
