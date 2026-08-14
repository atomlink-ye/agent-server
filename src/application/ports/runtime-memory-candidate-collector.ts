export type RuntimeMemoryCandidateCategory =
  | 'terminology'
  | 'output_preference'
  | 'project_constraint'
  | 'confirmed_workflow_procedure';

export interface RuntimeMemoryCandidate {
  readonly category: RuntimeMemoryCandidateCategory;
  readonly content: string;
}

export interface RuntimeMemoryCandidateSession {
  decoratePrompt(prompt: string): string;
  collect(): Promise<readonly RuntimeMemoryCandidate[]>;
}

export interface RuntimeMemoryCandidateCollector {
  prepare(input: {
    readonly runId: string;
    readonly cwd: string;
    readonly proposalLimit: number;
  }): Promise<RuntimeMemoryCandidateSession>;
}
