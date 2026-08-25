import {
  parseWorkerPackage,
  type ParsedWorkerPackage,
} from '../../domain/workers/worker-package.js';
import { SUPPORTED_MANAGED_AGENT_TOOL_REFS } from '../agents/built-in-skills.js';
import { WorkerPackageValidationError } from './errors.js';

export function parseWorkerForImport(source: string): ParsedWorkerPackage {
  try {
    const parsed = parseWorkerPackage(source);
    const seen = new Set<string>();
    for (const tool of parsed.package.spec.tools) {
      if (
        seen.has(tool.ref) ||
        !SUPPORTED_MANAGED_AGENT_TOOL_REFS.has(tool.ref)
      )
        throw new WorkerPackageValidationError();
      seen.add(tool.ref);
    }
    return parsed;
  } catch {
    throw new WorkerPackageValidationError();
  }
}

export function validateWorkerPackage(source: string) {
  const parsed = parseWorkerForImport(source);
  return Object.freeze({
    valid: true as const,
    fingerprint: parsed.fingerprint,
    compiler: parsed.compiler,
    metadata: Object.freeze({ normalizedName: parsed.normalizedName }),
  });
}
