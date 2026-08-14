export interface RequestLedgerRecord {
  readonly generation: number;
  readonly inFlightAtStart: number;
  readonly method: string;
  readonly url: string;
  readonly sameOrigin: boolean;
  readonly path: string;
  readonly query: string;
  lifecycle: 'started' | 'settled' | 'rejected';
  responseStatus: number | null;
  error: unknown | null;
  inFlightAtSettle: number | null;
  readonly postSeal: boolean;
}

export interface RequestLedgerSnapshot {
  readonly sealed: boolean;
  readonly generation: number;
  readonly inFlight: number;
  readonly records: readonly RequestLedgerRecord[];
  readonly postSealActivity: readonly RequestLedgerRecord[];
}

export class RequestLedgerIncompleteError extends Error {
  public readonly reason: string;
  public readonly details: Readonly<Record<string, unknown>>;

  public constructor(
    reason: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(`request_ledger_incomplete:${reason}`);
    this.name = 'RequestLedgerIncompleteError';
    this.reason = reason;
    this.details = details;
  }
}

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function requestUrl(input: RequestInfo | URL): URL {
  return new URL(String(input), 'http://request-ledger.invalid');
}

function requestMethod(init?: RequestInit): string {
  return String(init?.method ?? 'GET').toUpperCase();
}

function quietTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function createRequestLedger(
  fetchImpl: FetchLike,
  {
    timeoutMs = 500,
    quietTurns = 2,
    postSealGuardMs = 25,
  }: {
    readonly timeoutMs?: number;
    readonly quietTurns?: number;
    readonly postSealGuardMs?: number;
  } = {},
) {
  const records: RequestLedgerRecord[] = [];
  const postSealActivity: RequestLedgerRecord[] = [];
  let generation = 0;
  let inFlight = 0;
  let sealed = false;
  let collectorError: unknown = null;

  const snapshot = (): RequestLedgerSnapshot => ({
    sealed,
    generation,
    inFlight,
    records: records.slice(),
    postSealActivity: postSealActivity.slice(),
  });

  const fetch: FetchLike = async (input, init) => {
    let url: URL;
    let method: string;
    try {
      url = requestUrl(input);
      method = requestMethod(init);
    } catch (error) {
      collectorError = error;
      throw error;
    }

    const record: RequestLedgerRecord = {
      generation: ++generation,
      inFlightAtStart: inFlight,
      method,
      url: url.href,
      sameOrigin: url.origin === 'http://request-ledger.invalid',
      path: url.pathname,
      query: url.search,
      lifecycle: 'started',
      responseStatus: null,
      error: null,
      inFlightAtSettle: null,
      postSeal: sealed,
    };
    records.push(record);
    inFlight += 1;
    if (sealed) postSealActivity.push(record);

    try {
      const response = await fetchImpl(input, init);
      record.lifecycle = 'settled';
      record.responseStatus = response.status;
      return response;
    } catch (error) {
      record.lifecycle = 'rejected';
      record.error = error;
      throw error;
    } finally {
      inFlight -= 1;
      record.inFlightAtSettle = inFlight;
    }
  };

  const seal = async (): Promise<RequestLedgerSnapshot> => {
    const deadline = Date.now() + timeoutMs;
    let quiet = 0;
    while (quiet < quietTurns) {
      if (collectorError) {
        throw new RequestLedgerIncompleteError('collector-error', {
          cause: collectorError,
        });
      }
      quiet = inFlight === 0 ? quiet + 1 : 0;
      if (Date.now() >= deadline) {
        throw new RequestLedgerIncompleteError('timeout-or-pending', {
          inFlight,
          records: records.slice(),
        });
      }
      await quietTurn();
    }
    if (inFlight !== 0) {
      throw new RequestLedgerIncompleteError('pending-at-seal', { inFlight });
    }
    sealed = true;
    await new Promise((resolve) => setTimeout(resolve, postSealGuardMs));
    if (postSealActivity.length > 0) {
      throw new RequestLedgerIncompleteError('post-seal-activity', {
        records: postSealActivity.slice(),
      });
    }
    return snapshot();
  };

  return { fetch, seal, snapshot };
}
