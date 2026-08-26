const CANARY_TIMEOUT_ENV = 'CANARY_READY_TIMEOUT_MS';
const PASEO_TIMEOUT_ENV = 'PASEO_DAEMON_STARTUP_TIMEOUT_MS';

export const CORE_READINESS_TIMEOUT_MS = 30_000;
export const RUNTIME_READINESS_TIMEOUT_MS = 60_000;
export const CANARY_READINESS_TIMEOUT_MS = 300_000;

export function runtimeReadinessTimeout(
  environment: NodeJS.ProcessEnv,
): number {
  const canary = positiveSafeTimeout(environment, CANARY_TIMEOUT_ENV);
  const paseo = positiveSafeTimeout(environment, PASEO_TIMEOUT_ENV);
  return canary ?? paseo ?? RUNTIME_READINESS_TIMEOUT_MS;
}

export function canaryReadinessTimeout(environment: NodeJS.ProcessEnv): number {
  const canary = positiveSafeTimeout(environment, CANARY_TIMEOUT_ENV);
  const paseo = positiveSafeTimeout(environment, PASEO_TIMEOUT_ENV);
  return canary ?? paseo ?? CANARY_READINESS_TIMEOUT_MS;
}

function positiveSafeTimeout(
  environment: NodeJS.ProcessEnv,
  name: string,
): number | undefined {
  const raw = environment[name];
  if (raw === undefined) return undefined;
  const value = raw.trim();
  if (!/^[1-9][0-9]*$/u.test(value))
    throw new Error(`${name} must be a positive safe integer in milliseconds.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new Error(`${name} must be a positive safe integer in milliseconds.`);
  return parsed;
}
