import {
  parseManagedAgentPackage,
  type ParsedManagedAgentPackage,
} from '../../domain/agents/managed-agent-package.js';
import { AgentPackageValidationError } from './errors.js';
import { normalizeManagedAgentName } from '../../domain/agents/managed-agent-owner.js';
export interface ValidationResult {
  readonly fingerprint: string;
  readonly compiler: ParsedManagedAgentPackage['compiler'];
  readonly metadata: Readonly<{ normalizedName: string }>;
  readonly report: Readonly<{ valid: true }>;
}
export function validateAgentPackage(source: string): ValidationResult {
  try {
    const parsed = parseForImport(source);
    const normalizedName = normalizeManagedAgentName(
      parsed.package.metadata.name,
    );
    if (!normalizedName) throw new AgentPackageValidationError();
    return {
      fingerprint: parsed.fingerprint,
      compiler: parsed.compiler,
      metadata: { normalizedName },
      report: { valid: true },
    };
  } catch {
    throw new AgentPackageValidationError();
  }
}
export function parseForImport(source: string): ParsedManagedAgentPackage {
  try {
    return parseManagedAgentPackage(source);
  } catch {
    throw new AgentPackageValidationError();
  }
}
export class ValidateAgentPackage {
  execute(source: string): ValidationResult {
    return validateAgentPackage(source);
  }
}
