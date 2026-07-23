const RUNTIME_CONTRACT_HEADER =
  'Runtime contract: execute the supplied task input using the published agent instructions. Do not infer or access other session history.';

export interface AssembleContextInput {
  readonly instructions: string;
  readonly taskInput: string;
  readonly memory?: string | null;
}

export function assembleContext(input: AssembleContextInput): string {
  return [
    RUNTIME_CONTRACT_HEADER,
    `Published AgentVersion instructions:\n${input.instructions}`,
    `Current Task input:\n${input.taskInput}`,
    ...(input.memory ? [`Pinned verified MEMORY.md:\n${input.memory}`] : []),
  ].join('\n\n');
}

export { RUNTIME_CONTRACT_HEADER };
