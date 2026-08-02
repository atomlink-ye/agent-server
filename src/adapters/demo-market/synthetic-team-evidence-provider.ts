import {
  SYNTHETIC_MARKET_FIXTURE_REF,
  SyntheticMarketAdapter,
} from './synthetic-market-adapter.js';
import type {
  TeamEvidenceProvider,
  TeamWorkAttemptEvidence,
} from '../../application/ports/team-evidence-provider.js';

export class SyntheticTeamEvidenceProvider implements TeamEvidenceProvider {
  public constructor(private readonly market = new SyntheticMarketAdapter()) {}

  public getWorkAttemptEvidence(input: {
    readonly attemptNo: number;
    readonly feedback: string | null;
  }): TeamWorkAttemptEvidence {
    const request = {
      fixture_ref: SYNTHETIC_MARKET_FIXTURE_REF,
      symbol: 'ACME',
    } as const;
    const snapshot = this.market.stockSnapshot(request);
    if (input.attemptNo === 2 && input.feedback?.trim()) {
      const events = this.market.eventBatch(request);
      return {
        synthetic: true,
        fixture_ref: SYNTHETIC_MARKET_FIXTURE_REF,
        symbol: 'ACME',
        data_as_of: events.data_as_of,
        snapshot: null,
        events: events.data.events,
      };
    }
    return {
      synthetic: true,
      fixture_ref: SYNTHETIC_MARKET_FIXTURE_REF,
      symbol: 'ACME',
      data_as_of: snapshot.data_as_of,
      snapshot: snapshot.data,
      events: null,
    };
  }
}
