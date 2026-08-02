import type { ToolProfileRef } from './logical-ref.js';
import type { Sha256Fingerprint } from './project-canonicalization.js';

export interface LocalToolProfile {
  readonly apiVersion: 'agent-server/v1alpha1';
  readonly kind: 'LocalToolProfile';
  readonly metadata: { readonly name: string };
  readonly spec: {
    readonly tools: readonly {
      readonly ref: string;
      readonly kind: 'tool' | 'builtin';
    }[];
  };
}

export interface NormalizedLocalToolProfile {
  readonly ref: ToolProfileRef;
  readonly name: string;
  readonly source: string;
  readonly path: string;
  readonly sourceFingerprint: Sha256Fingerprint;
  readonly profile: LocalToolProfile;
}
