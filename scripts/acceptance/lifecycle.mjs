export function acceptanceRuntime(provider, model) {
  if (!provider?.trim()) throw new Error('acceptance provider must be explicit');
  if (!model?.trim()) throw new Error('acceptance model must be explicit');
  return Object.freeze({ adapter: 'paseo', provider, model });
}

export async function startAcceptanceEnvironment({ provider, model, runDirectory, projectName }) {
  const { startLocalEnvironment } = await import('../../tooling/environment/lifecycle.ts');
  return startLocalEnvironment({
    profile: 'full',
    testMode: true,
    projectName,
    runDirectory,
    runtimeOverrides: acceptanceRuntime(provider, model),
  });
}

export function apiProbeUrl(handle) {
  if (!handle.urls.api) throw new Error('acceptance lifecycle did not allocate an API URL');
  return `${handle.urls.api}/health/ready`;
}
