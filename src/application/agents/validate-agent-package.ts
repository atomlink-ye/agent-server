import {
  ManagedAgentPackageError,
  parseManagedAgentPackage,
  type ParsedManagedAgentPackage,
} from '../../domain/agents/managed-agent-package.js';
import { SUPPORTED_MANAGED_AGENT_TOOL_REFS } from './built-in-skills.js';
import { AgentPackageValidationError } from './errors.js';
export interface ValidationResult {
  readonly fingerprint: string;
  readonly compiler: ParsedManagedAgentPackage['compiler'];
  readonly metadata: Readonly<{ normalizedName: string }>;
  readonly report: Readonly<{ valid: true }>;
}
export function validateAgentPackage(source: string): ValidationResult {
  try {
    const parsed = parseForImport(source);
    return {
      fingerprint: parsed.fingerprint,
      compiler: parsed.compiler,
      metadata: { normalizedName: parsed.normalizedName },
      report: { valid: true },
    };
  } catch {
    throw new AgentPackageValidationError();
  }
}
export function parseForImport(source: string): ParsedManagedAgentPackage {
  try {
    const parsed = parseManagedAgentPackage(source);
    assertSupportedToolRefs(parsed);
    return parsed;
  } catch {
    throw new AgentPackageValidationError();
  }
}

/**
 * Authoring must reject exactly what resolution rejects.
 *
 * `ResolveAgentVersion` fails closed on tool refs outside
 * `SUPPORTED_MANAGED_AGENT_TOOL_REFS`, but import only checked the shape of
 * `spec.tools`, so a package could be imported and published and then never
 * resolve in Chat. Platform capabilities such as Agent Team collaboration are
 * composed by the runtime and are deliberately absent from the supported set,
 * so they must not be declared here either.
 *
 * This lives in the application layer because the supported set is an
 * application concern; the domain parser must not import upwards.
 */
function assertSupportedToolRefs(parsed: ParsedManagedAgentPackage): void {
  const seen = new Set<string>();
  for (const [index, tool] of parsed.package.spec.tools.entries()) {
    const path = `$.spec.tools[${index}].ref`;
    if (seen.has(tool.ref))
      throw new ManagedAgentPackageError('duplicate_tool_reference', path);
    if (!SUPPORTED_MANAGED_AGENT_TOOL_REFS.has(tool.ref))
      throw new ManagedAgentPackageError('unsupported_tool_reference', path);
    seen.add(tool.ref);
  }
}
export class ValidateAgentPackage {
  execute(source: string): ValidationResult {
    return validateAgentPackage(source);
  }
}
