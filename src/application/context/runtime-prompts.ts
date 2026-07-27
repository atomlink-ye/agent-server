export const PLATFORM_RUNTIME_KERNEL =
  'Runtime contract: execute the supplied task input using the published agent instructions. Do not infer or access other session history.';

export function buildBootstrapPrompt(instructions?: string): string {
  return instructions
    ? `${PLATFORM_RUNTIME_KERNEL}\n\nPublished AgentVersion instructions:\n${instructions}`
    : PLATFORM_RUNTIME_KERNEL;
}

export function buildTurnPrompt(input: {
  readonly taskInput: string;
  readonly memory?: string | null;
}): string {
  return input.memory
    ? `Pinned verified MEMORY.md:\n${input.memory}\n\nCurrent Task input:\n${input.taskInput}`
    : input.taskInput;
}
