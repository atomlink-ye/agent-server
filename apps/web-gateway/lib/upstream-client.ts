import 'server-only';

const baseUrl = process.env.AGENT_SERVER_BASE_URL;
const serviceToken = process.env.AGENT_SERVER_SERVICE_TOKEN;

export class UpstreamConfigurationError extends Error {
  constructor() {
    super('Agent Server upstream is not configured.');
    this.name = 'UpstreamConfigurationError';
  }
}

export function agentServerUpstreamUrl(path: string): string {
  if (!baseUrl || !serviceToken) throw new UpstreamConfigurationError();
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

export function agentServerUpstreamHeaders(): HeadersInit {
  if (!baseUrl || !serviceToken) throw new UpstreamConfigurationError();
  return {
    authorization: `Bearer ${serviceToken}`,
    'content-type': 'application/json',
  };
}
