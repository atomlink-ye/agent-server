import { statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import {
  loadRealProviderDefaults,
  REAL_PROVIDER_DEFAULTS_PATH,
} from './real-provider-defaults.mjs';

try {
  loadRealProviderDefaults({});
  process.stdout.write(
    `real-provider defaults valid: ${REAL_PROVIDER_DEFAULTS_PATH}\n`,
  );
} catch (error) {
  process.stderr.write(
    `real-provider defaults invalid: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}

const key = process.env.OPENCODE_GO_API_KEY?.trim();
if (key) {
  process.stdout.write(
    '配置已就位，OPENCODE_GO_API_KEY 已导出，可运行真实 provider。\n',
  );
  process.exit(0);
}

const providerFile =
  process.env.AGENT_SERVER_PROVIDER_ENV_FILE?.trim() ||
  `${process.env.XDG_CONFIG_HOME || `${process.env.HOME || ''}/.config`}/agent-server/provider.env`;
let mode;
try {
  mode = statSync(providerFile).mode & 0o777;
} catch (error) {
  if (error?.code !== 'ENOENT') {
    process.stderr.write(`provider credentials unreadable: ${providerFile}\n`);
    process.exit(1);
  }
}
if (mode !== undefined && mode !== 0o600) {
  process.stderr.write(
    `provider credentials file must have mode 0600: ${providerFile} (found ${mode.toString(8).padStart(4, '0')})\n`,
  );
  process.exit(1);
}
if (mode === 0o600) {
  let hasKey = false;
  try {
    const declaration = (await readFile(providerFile, 'utf8'))
      .split(/\r?\n/u)
      .find((line) =>
        /^(?:export\s+)?OPENCODE_GO_API_KEY\s*=/u.test(line.trim()),
      );
    if (declaration) {
      let value = declaration.slice(declaration.indexOf('=') + 1).trim();
      if (
        value.length >= 2 &&
        ((value.startsWith("'") && value.endsWith("'")) ||
          (value.startsWith('"') && value.endsWith('"')))
      ) {
        value = value.slice(1, -1).trim();
      }
      hasKey = value.length > 0 && !value.startsWith('#');
    }
  } catch {}
  if (hasKey)
    process.stdout.write(
      `配置已就位，凭据文件存在但未导出：set -a; source ${providerFile}; set +a\n`,
    );
  else
    process.stdout.write(
      `配置已就位，凭据缺失，不能跑真实 provider。\nset -a; source ${providerFile}; set +a\n`,
    );
} else {
  process.stdout.write(
    `配置已就位，凭据缺失，不能跑真实 provider。\nset -a; source ${providerFile}; set +a\n`,
  );
}
