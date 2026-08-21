export function assertPreflight({ apiUrl, renderedPorts, expectedPorts, provider }) {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/u.test(apiUrl)) throw new Error('preflight API URL must derive from allocated loopback port');
  if (!provider?.trim()) throw new Error('preflight provider is missing');
  if (!renderedPorts || !expectedPorts) throw new Error('preflight port facts are missing');
  const renderedApiPort = renderedPorts.services?.['agent-server']?.ports?.[0]?.published;
  const expectedApiPort = String(expectedPorts['agent-server']?.published);
  const probePort = new URL(apiUrl).port;
  if (renderedApiPort !== expectedApiPort || probePort !== renderedApiPort) throw new Error(`preflight API port mismatch: probe=${probePort} rendered=${renderedApiPort}`);
}

export function assertFinalSql(observations) {
  if (!['claude', 'codex'].includes(observations.provider)) throw new Error('terminal provider is not accepted');
  if (!observations.workRef) throw new Error('terminal work_ref is missing');
  if (!observations.workRun || observations.workStatus !== 'complete') throw new Error(`terminal Work state is not complete: ${observations.workStatus}`);
}
