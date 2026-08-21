export const goldenEight = Object.freeze([
  'agents:import', 'agent-versions:publish', 'work-definitions:apply',
  'agents:import', 'agent-versions:publish', 'browser:create',
  'conversations:work-context', 'browser:send',
]);

export function assertGoldenRecord(record) {
  if (!Array.isArray(record) || record.length !== 8) throw new Error('golden record must contain exactly eight commands');
  for (let index = 0; index < goldenEight.length; index += 1) {
    if (record[index]?.kind !== goldenEight[index]) throw new Error(`golden command ${index + 1} mismatch`);
  }
}

export function assertStep8Observation(observation) {
  if (observation.maxWaitMs !== 600000) throw new Error('step-8 maxWaitMs must equal 600000');
  if (!observation.postReturnedAt) throw new Error('step-8 POST timestamp is missing');
  if (!Array.isArray(observation.actions) || observation.actions.some((action) => action !== 'dom-read' && action !== 'passive-wait')) throw new Error('step-8 observer performed a forbidden action');
  if (!observation.firstVisibleAt || !observation.workRef) throw new Error('step-8 did not observe a Work Card/workRef');
}
