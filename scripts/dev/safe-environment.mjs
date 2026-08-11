const safeVariableNames = new Set([
  'CI',
  'CODEX_NETWORK_ALLOW_LOCAL_BINDING',
  'CODEX_NETWORK_PROXY_ACTIVE',
  'CODEX_PROXY_CERT',
  'CODEX_SANDBOX_NETWORK_DISABLED',
  'COLORTERM',
  'CURL_CA_BUNDLE',
  'ELECTRON_GET_USE_PROXY',
  'GITHUB_ACTIONS',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'NODE_EXTRA_CA_CERTS',
  'NODE_USE_ENV_PROXY',
  'NO_COLOR',
  'PATH',
  'REQUESTS_CA_BUNDLE',
  'RUNNER_ARCH',
  'RUNNER_OS',
  'SHELL',
  'SSL_CERT_DIR',
  'SSL_CERT_FILE',
  'TEMP',
  'TERM',
  'TMP',
  'TMPDIR',
  'TZ',
]);

const proxyVariable = /^(?:HTTP|HTTPS|ALL|NO|FTP|WS|WSS)_PROXY$/i;
const toolProxyVariable =
  /^(?:(?:BUNDLE|DOCKER|YARN)_(?:HTTP|HTTPS|NO)_PROXY|NPM_CONFIG_(?:HTTP|HTTPS|NO)?PROXY)$/i;

export function createSafeRuntimeEnvironment(source = process.env) {
  const selected = {};
  for (const [name, value] of Object.entries(source)) {
    if (
      value !== undefined &&
      (safeVariableNames.has(name) ||
        proxyVariable.test(name) ||
        toolProxyVariable.test(name))
    ) {
      selected[name] = value;
    }
  }
  return selected;
}

export function copyNamedEnvironment(source, names) {
  const selected = {};
  for (const name of names) {
    const value = source[name];
    if (value !== undefined && value.trim() !== '') {
      selected[name] = value;
    }
  }
  return selected;
}
