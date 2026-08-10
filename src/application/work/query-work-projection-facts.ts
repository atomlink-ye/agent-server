import type {
  WorkProjectionFacts,
  WorkProjectionFactsQuery,
  WorkProjectionFactsReader,
  WorkProjectionWorkspaceScope,
} from './work-projection-facts.js';

export class QueryWorkProjectionFacts implements WorkProjectionFactsQuery {
  public constructor(private readonly source: WorkProjectionFactsReader) {}

  public getByRootTask(
    input: WorkProjectionWorkspaceScope & { readonly rootTaskId: string },
  ): Promise<WorkProjectionFacts | null> {
    return this.source.getByRootTask(input, input.rootTaskId);
  }
}
