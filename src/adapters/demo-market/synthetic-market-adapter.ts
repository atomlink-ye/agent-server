export const SYNTHETIC_MARKET_FIXTURE_REF =
  'fixture://self-learning-market-research/acme-v1';

type SyntheticEnvelope<T> = Readonly<{
  synthetic: true;
  data_as_of: '2026-07-31';
  fixture_source_refs: readonly [typeof SYNTHETIC_MARKET_FIXTURE_REF];
  disclaimer: 'synthetic demo only';
  data: T;
}>;

const common = {
  synthetic: true as const,
  data_as_of: '2026-07-31' as const,
  fixture_source_refs: [SYNTHETIC_MARKET_FIXTURE_REF] as const,
  disclaimer: 'synthetic demo only' as const,
};

export class SyntheticMarketAdapter {
  public stockSnapshot(input: { fixture_ref: string; symbol: string }) {
    validate(input);
    return envelope({
      ...common,
      data: {
        fixture_ref: input.fixture_ref,
        symbol: input.symbol,
        last_price: 101.25,
        volume_index: 1.18,
      },
    });
  }

  public eventBatch(input: { fixture_ref: string; symbol: string }) {
    validate(input);
    return envelope({
      ...common,
      data: {
        fixture_ref: input.fixture_ref,
        symbol: input.symbol,
        events: [
          {
            id: 'acme-event-01',
            kind: 'product-update',
            date: '2026-07-29',
            relevance: 'moderate',
          },
        ],
      },
    });
  }

  public analogSummary(input: { fixture_ref: string; symbol: string }) {
    validate(input);
    return envelope({
      ...common,
      data: {
        fixture_ref: input.fixture_ref,
        symbol: input.symbol,
        analogs: [
          {
            id: 'analog-alpha',
            similarity: 'bounded-medium',
            outcome_band: 'mixed',
          },
        ],
        risk_notes: [
          'Synthetic values do not represent market data.',
          'No precise backtest or investment recommendation is provided.',
        ],
      },
    });
  }
}

function validate(input: { fixture_ref: string; symbol: string }): void {
  if (
    input.fixture_ref !== SYNTHETIC_MARKET_FIXTURE_REF ||
    input.symbol !== 'ACME'
  )
    throw new Error('Unsupported synthetic market fixture.');
}

function envelope<T>(value: SyntheticEnvelope<T>): SyntheticEnvelope<T> {
  return value;
}
