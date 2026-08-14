export class RequestLedgerIncompleteError extends Error {
  constructor(reason, details = {}) {
    super(`c3_e8_request_ledger_incomplete:${reason}`);
    this.name = 'RequestLedgerIncompleteError';
    this.reason = reason;
    this.details = details;
  }
}
function requestUrl(input) {
  return new URL(String(input), 'http://c3-e8-request-ledger.invalid');
}

function requestMethod(init) {
  return String(init?.method ?? 'GET').toUpperCase();
}

function quietTurn() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function createRequestLedger(
  fetchImpl,
  { timeoutMs = 500, quietTurns = 2, postSealGuardMs = 125 } = {},
) {
  if (typeof fetchImpl !== 'function')
    throw new TypeError('c3_e8_request_ledger:fetch-required');

  const records = [];
  const postSealActivity = [];
  let generation = 0;
  let inFlight = 0;
  let sealed = false;
  let collectorError = null;

  const fetch = async (input, init) => {
    let url;
    let method;
    try {
      url = requestUrl(input);
      method = requestMethod(init);
    } catch (error) {
      collectorError = error;
      throw error;
    }

    const record = {
      generation: ++generation,
      inFlightAtStart: inFlight,
      method,
      url: url.href,
      sameOrigin: url.origin === 'http://c3-e8-request-ledger.invalid',
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
      record.responseStatus = response?.status ?? null;
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

  async function seal() {
    const deadline = Date.now() + timeoutMs;
    let quiet = 0;
    while (quiet < quietTurns) {
      if (collectorError)
        throw new RequestLedgerIncompleteError('collector-error', {
          cause: collectorError,
        });
      if (inFlight !== 0) {
        quiet = 0;
      } else {
        quiet += 1;
      }
      if (Date.now() >= deadline)
        throw new RequestLedgerIncompleteError('timeout-or-pending', {
          inFlight,
          records: records.slice(),
        });
      await quietTurn();
    }
    if (inFlight !== 0)
      throw new RequestLedgerIncompleteError('pending-at-seal', { inFlight });
    sealed = true;
    await new Promise((resolve) => setTimeout(resolve, postSealGuardMs));
    if (postSealActivity.length > 0)
      throw new RequestLedgerIncompleteError('post-seal-activity', {
        records: postSealActivity.slice(),
      });
    if (collectorError)
      throw new RequestLedgerIncompleteError('collector-error', {
        cause: collectorError,
      });
    return snapshot();
  }

  function snapshot() {
    return {
      sealed,
      generation,
      inFlight,
      records: records.slice(),
      postSealActivity: postSealActivity.slice(),
    };
  }

  return {
    fetch,
    seal,
    snapshot,
    get sealed() {
      return sealed;
    },
  };
}
