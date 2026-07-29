export const MAX_CHILD_RESULT_BYTES = 32 * 1024;
export const MAX_HANDOFF_BYTES = 64 * 1024;

export function buildTeamHandoff(input: {
  rootBrief: string;
  sources: readonly {
    nodeId: string;
    taskId: string;
    runId: string;
    result: string;
  }[];
}): string {
  const sourceText = input.sources
    .map((source) => {
      assertBounded(
        source.result,
        MAX_CHILD_RESULT_BYTES,
        `Child result ${source.nodeId}`,
      );
      return `Node ${source.nodeId} (task ${source.taskId}, run ${source.runId}):\n${source.result}`;
    })
    .join('\n\n');
  const handoff = `Root brief:\n${input.rootBrief}\n\nSources:\n${sourceText}`;
  assertBounded(handoff, MAX_HANDOFF_BYTES, 'Team handoff');
  return handoff;
}

function assertBounded(value: string, limit: number, label: string): void {
  if (Buffer.byteLength(value, 'utf8') > limit)
    throw new Error(`${label} exceeds the bounded handoff limit.`);
}
