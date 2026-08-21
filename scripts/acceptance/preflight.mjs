// 🔴 provider 从"只验非空"改成建立关系：先前它是个【收下但从不使用】的参数，
// 任何字符串都能通过，等于没有判据（Oracle 指出，成立）。
// 现在断言【请求的 provider】与【实际交给 Compose 的那个】相同。
export function assertPreflight({ apiUrl, renderedPorts, expectedPorts, requestedProvider, effectiveProvider }) {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/u.test(apiUrl)) throw new Error('preflight API URL must derive from allocated loopback port');
  if (!requestedProvider?.trim()) throw new Error('preflight requested provider is missing');
  if (!effectiveProvider?.trim()) throw new Error('preflight effective provider not observed in the lifecycle environment');
  if (requestedProvider !== effectiveProvider) {
    throw new Error(`preflight provider mismatch: requested=${requestedProvider} effective=${effectiveProvider}`);
  }
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
