export function assertPreflight({ apiUrl, renderedPorts, expectedPorts, provider }) {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/u.test(apiUrl)) throw new Error('preflight API URL must derive from allocated loopback port');
  if (!provider?.trim()) throw new Error('preflight provider is missing');
  if (!renderedPorts || !expectedPorts) throw new Error('preflight port facts are missing');
}

export function assertFinalSql(observations) {
  if (!['claude', 'codex'].includes(observations.provider)) throw new Error('terminal provider is not accepted');
  if (!observations.workRef) throw new Error('terminal work_ref is missing');
  if (!observations.workRun || !observations.workStatus) throw new Error('terminal WorkRun/Work state is missing');
}
