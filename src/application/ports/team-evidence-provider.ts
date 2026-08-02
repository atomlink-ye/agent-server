export interface TeamWorkAttemptEvidence {
  readonly synthetic: true;
  readonly fixture_ref: string;
  readonly symbol: string;
  readonly data_as_of: string;
  readonly snapshot: Readonly<Record<string, unknown>> | null;
  readonly events: readonly Readonly<Record<string, unknown>>[] | null;
}

export interface TeamEvidenceProvider {
  getWorkAttemptEvidence(input: {
    readonly attemptNo: number;
    readonly feedback: string | null;
  }): TeamWorkAttemptEvidence;
}
