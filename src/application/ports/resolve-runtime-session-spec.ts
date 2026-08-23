import type { RuntimeSessionOwner } from '../../domain/runtime/runtime-session.js';
import type {
  RuntimeDigestComponent,
  RuntimeResolvedSkill,
  RuntimeSessionSpec,
} from '../../domain/runtime/runtime-session-spec.js';

/**
 * Owner-provided desired-state values required to assemble a runtime spec.
 * Each digest is a stable opaque fingerprint; this port neither derives nor
 * substitutes any component value.
 */
export interface RuntimeSessionSpecConfiguration {
  readonly provider: string;
  readonly model: string | null;
  readonly cwd: string;
  readonly systemPromptDigest: RuntimeDigestComponent;
  readonly skillSetDigest: RuntimeDigestComponent;
  readonly toolCatalogDigest: RuntimeDigestComponent;
  readonly extensionSetDigest: RuntimeDigestComponent;
  readonly contextEpoch: number;
}

/** Exact identity and desired inputs needed for one immutable spec revision. */
export interface ResolveRuntimeSessionSpecInput {
  readonly owner: RuntimeSessionOwner;
  readonly agentVersionId: string;
  readonly environmentVersionId: string | null;
  readonly resolvedSkills: readonly RuntimeResolvedSkill[];
  readonly toolRefs: readonly string[];
  readonly configuration: RuntimeSessionSpecConfiguration;
}

/** Assembles exactly one complete RuntimeSessionSpec; it has no fallback mode. */
export interface ResolveRuntimeSessionSpec {
  execute(input: ResolveRuntimeSessionSpecInput): RuntimeSessionSpec;
}
