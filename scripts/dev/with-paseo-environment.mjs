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
  // The API process selects the Claude launch mode from the active transport, so
  // it needs the transport flag itself. Bedrock credentials stay with the daemon.
  'CLAUDE_CODE_USE_BEDROCK',
  // The Codex home the runtime prepared. The API process passes it to Paseo
  // per session so a product Agent's provider process never falls back to the
  // operator's own `~/.codex` -- which would brief it with that person's
  // global AGENTS.md, MCP servers and plugins.
  'CODEX_HOME',
  // The home the runtime prepared for provider processes. Codex reads skills
  // from `$HOME/.agents/skills` as well as from `$CODEX_HOME`, so an Agent
  // whose provider keeps the operator's HOME is briefed with that person's
  // skill library no matter where CODEX_HOME points.
  'PASEO_PROVIDER_HOME',
  // Claude Code's login lives in the macOS Keychain, which it reaches through
  // the operator's own HOME -- the very thing PASEO_PROVIDER_HOME replaces. So
  // the isolation above logs Claude out, and the credential has to travel the
  // other way: the API process passes this token to Paseo per session, exactly
  // as it does CODEX_HOME. A `claude setup-token` value carries `user:inference`
  // only and is not the operator's session credential, so the runtime can hold
  // one without being able to act as that person.
  'CLAUDE_CODE_OAUTH_TOKEN',
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
