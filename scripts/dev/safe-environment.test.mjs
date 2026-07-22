import { describe, expect, it } from 'vitest';

import {
  copyNamedEnvironment,
  createSafeRuntimeEnvironment,
} from './safe-environment.mjs';

describe('runtime environment isolation', () => {
  it('keeps runtime plumbing while dropping credentials and unrelated secrets', () => {
    const environment = createSafeRuntimeEnvironment({
      PATH: '/usr/bin',
      HTTPS_PROXY: 'http://proxy.invalid',
      NODE_EXTRA_CA_CERTS: '/certs/proxy.pem',
      LANG: 'C.UTF-8',
      GITHUB_TOKEN: 'github-secret',
      NODE_REPL_AUTH_TOKEN: 'node-secret',
      OPENAI_API_KEY: 'model-secret',
      RSYNC_PASSWORD: 'storage-secret',
    });

    expect(environment).toEqual({
      PATH: '/usr/bin',
      HTTPS_PROXY: 'http://proxy.invalid',
      NODE_EXTRA_CA_CERTS: '/certs/proxy.pem',
      LANG: 'C.UTF-8',
    });
  });

  it('copies only explicitly named application configuration', () => {
    expect(
      copyNamedEnvironment(
        { PORT: '4000', PASEO_MODEL: 'opencode/free', TOKEN: 'secret' },
        ['PORT', 'PASEO_MODEL'],
      ),
    ).toEqual({ PORT: '4000', PASEO_MODEL: 'opencode/free' });
  });
});
