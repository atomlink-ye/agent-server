export type SmokeCompletionFailure = Readonly<{
  scope: 'collaboration' | 'assertion';
  code: string;
  expected: string;
  actual: unknown;
}>;

export type SmokeCompletionEvaluation = Readonly<{
  ok: boolean;
  failures: readonly SmokeCompletionFailure[];
}>;

export type SmokeOutcome = Readonly<{
  kind:
    | 'pending'
    | 'success'
    | 'gate_timeout'
    | 'collaboration_not_achieved'
    | 'assertion_failed';
  taskStatus: string | null;
  failures: readonly SmokeCompletionFailure[];
}>;

export function acknowledgedMessagesWithoutActivation(
  value: unknown,
): readonly unknown[];

export function evaluateCompletionFacts(
  value: unknown,
): SmokeCompletionEvaluation;

export function classifySmokeOutcome(input: {
  readonly taskStatus: string | null | undefined;
  readonly projection: unknown;
  readonly timedOut?: boolean;
}): SmokeOutcome;

export function formatSmokeOutcome(outcome: SmokeOutcome): string;
