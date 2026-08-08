import {
  PROVIDER_SMOKE_MODEL,
  PROVIDER_SMOKE_PROVIDER,
} from '../dev/provider-smoke-contract.mjs';

const apiKey = process.env.OPENCODE_GO_API_KEY?.trim() ?? '';
const provider = process.env.PASEO_PROVIDER?.trim() ?? '';
const model = process.env.PASEO_MODEL?.trim() ?? '';

if (!apiKey && !provider && !model) {
  process.stdout.write('should_run=false\n');
  process.exit(0);
}

if (
  !apiKey ||
  provider !== PROVIDER_SMOKE_PROVIDER ||
  model !== PROVIDER_SMOKE_MODEL
) {
  process.stderr.write(
    'provider_smoke_env_invalid: expected OPENCODE_GO_API_KEY plus the pinned provider and model\n',
  );
  process.exit(1);
}

process.stdout.write('should_run=true\n');
