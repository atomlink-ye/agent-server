export const MARKER_CLASSES = [
  'absent',
  'exact-selected-kind',
  'exact-other-kind',
  'near-miss',
];

export function classifyWorkAcceptanceOutcome({
  status,
  signal,
  error,
  markerClass,
}) {
  const cleanTermination = signal === null && error === null;
  if (status === 0 && cleanTermination) return 0;
  if (status === 1 && cleanTermination && markerClass === 'exact-selected-kind')
    return 2;
  return 1;
}

export function outcomeRuleMatches(point) {
  const cleanTermination = point.signal === null && point.error === null;
  return [
    {
      rule: 'PASS_CLEAN_STATUS_ZERO',
      matches: point.status === 0 && cleanTermination,
      exit: 0,
    },
    {
      rule: 'MISSING_CLEAN_STATUS_ONE_SELECTED_MARKER',
      matches:
        point.status === 1 &&
        cleanTermination &&
        point.markerClass === 'exact-selected-kind',
      exit: 2,
    },
    {
      rule: 'FAIL_ALL_REMAINING_OUTCOMES',
      matches: !(
        (point.status === 0 && cleanTermination) ||
        (point.status === 1 &&
          cleanTermination &&
          point.markerClass === 'exact-selected-kind')
      ),
      exit: 1,
    },
  ];
}

export function structuralReachability({ status, signal, error }) {
  if (error !== null)
    return status === null
      ? 'RUNTIME_REPRESENTATIVE'
      : 'STRUCTURALLY_UNREACHABLE:observed spawnSync spawn/maxBuffer errors have status=null';
  if (signal !== null)
    return status === null
      ? 'RUNTIME_REPRESENTATIVE'
      : 'STRUCTURALLY_UNREACHABLE:spawnSync signal implies status=null';
  if (status === null)
    return 'STRUCTURALLY_UNREACHABLE:spawnSync completion without error or signal has numeric status';
  return 'RUNTIME_REPRESENTATIVE';
}
