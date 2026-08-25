import { copyNamedEnvironment } from './safe-environment.mjs';

export const applicationEnvironmentNames = [
  'NODE_ENV',
  'HOST',
  'PORT',
  'LOG_LEVEL',
  'SERVICE_NAME',
  'PASEO_MODEL',
  'PASEO_CONNECT_TIMEOUT_MS',
  'PASEO_EXECUTION_TIMEOUT_MS',
  'PASEO_SESSION_RPC_TIMEOUT_MS',
  'AGENT_SERVER_DISPATCHER_CONCURRENCY',
  'DATABASE_URL',
  'POSTGRES_URL',
  'SERVICE_ACCOUNTS_JSON',
  'PASEO_RUNTIME_ROOT',
  'PASEO_RUNTIME_CELL_ROOT',
  'AGENT_SERVER_SKILL_REGISTRY_ROOT',
];

export function createApplicationEnvironment({
  paseoEnvironment,
  environment,
  paseoWsUrl,
  agentWorkspace,
}) {
  return {
    ...paseoEnvironment,
    ...copyNamedEnvironment(environment, applicationEnvironmentNames),
    PASEO_WS_URL: paseoWsUrl,
    PASEO_AGENT_CWD: agentWorkspace,
    PASEO_WORKSPACE_TITLE: 'Agent Server Development',
  };
}
