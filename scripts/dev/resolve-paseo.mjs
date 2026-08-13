import { resolveProviderBinary } from './resolve-provider.mjs';

export async function resolvePaseoBinary() {
  return resolveProviderBinary('paseo', 'PASEO_BIN');
}
