function probeFilePresent(resultRecord, record, probeName) {
  const resultValue = resultRecord?.[probeName]?.file_present;
  if (typeof resultValue === 'boolean') return resultValue;

  const recordValue =
    record?.runtime_inspection?.paseo_runtime?.[probeName]?.file_present;
  if (typeof recordValue === 'boolean') return recordValue;

  throw new Error(`runtime_cleanup_probe_invalid:${probeName}`);
}

export function runtimeBoundaryCleanupProbes(resultRecord, record) {
  return {
    runtime_state_probe_file_present: probeFilePresent(
      resultRecord,
      record,
      'runtime_state_probe',
    ),
    workspace_probe_file_present: probeFilePresent(
      resultRecord,
      record,
      'workspace_write_probe',
    ),
  };
}
