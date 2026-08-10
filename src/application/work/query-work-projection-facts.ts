import type {
  WorkProjectionFacts,
  WorkProjectionFactsQuery,
  WorkProjectionFactsReader,
  WorkProjectionWorkspaceScope,
} from './work-projection-facts.js';

/** Application query boundary for the Workspace-scoped Work facts. */
export class QueryWorkProjectionFacts implements WorkProjectionFactsQuery {
  public constructor(private readonly source: WorkProjectionFactsReader) {}

  public getByRootTask(
    input: WorkProjectionWorkspaceScope & { readonly rootTaskId: string },
  ): Promise<WorkProjectionFacts | null> {
    return this.source.getByRootTask(input, input.rootTaskId);
  }
}
