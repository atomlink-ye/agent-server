export const OBSERVER_COMPLETE = 'COMPLETE_AND_PROVEN_ABSENT';
export const OBSERVER_MISSING = 'MISSING_EVIDENCE';
export const OBSERVER_FAIL = 'UNSOUND_ABSENCE';

export class PageObserverIncompleteError extends Error {
  constructor(reason, details = {}) {
    super(`c4_page_observer_incomplete:${reason}`);
    this.name = 'PageObserverIncompleteError';
    this.reason = reason;
    this.details = details;
  }
}

const DEFAULT_ORIGIN = 'http://c4-page-observer.invalid';

function parseUrl(value, origin) {
  return new URL(String(value), origin || DEFAULT_ORIGIN);
}

function requestKey(url, method) {
  return `${method.toUpperCase()} ${url.pathname}${url.search}`;
}

function matchesRule(record, rule) {
  if (record.method !== String(rule.method).toUpperCase()) return false;
  if (typeof rule.path === 'function' && !rule.path(record.path)) return false;
  if (rule.path instanceof RegExp && !rule.path.test(record.path)) return false;
  if (typeof rule.path === 'string' && rule.path !== record.path) return false;
  if (typeof rule.query === 'function' && !rule.query(record.query)) return false;
  if (typeof rule.query === 'string' && rule.query !== record.query) return false;
  return true;
}

function quietTurn() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function createPageObserver({
  page,
  origin,
  allowlist = [],
  parseBody,
  timeoutMs = 2_000,
  quietTurns = 2,
  postSealGuardMs = 125,
} = {}) {
  const records = [];
  const byRequest = new WeakMap();
  const fallbackByKey = new Map();
  const listenerErrors = [];
  const bodyPromises = new Set();
  const postSealActivity = [];
  let inFlight = 0;
  let generation = 0;
  let sealed = false;
  let attached = false;

  function failListener(error) {
    listenerErrors.push(error);
  }

  function getRequestData(request) {
    const url = parseUrl(request.url(), origin);
    const method = String(request.method?.() ?? 'GET').toUpperCase();
    return { url, method };
  }

  function findRecord(source) {
    if (source && typeof source === 'object') {
      const direct = byRequest.get(source);
      if (direct) return direct;
    }
    let data;
    try {
      data = getRequestData(source.request?.() ?? source);
    } catch {
      return undefined;
    }
    const queue = fallbackByKey.get(requestKey(data.url, data.method));
    return queue?.find((entry) => entry.lifecycle === 'started');
  }

  function observeRequest(request) {
    try {
      const { url, method } = getRequestData(request);
      const record = {
        generation: ++generation,
        method,
        url: url.href,
        sameOrigin: url.origin === origin,
        path: url.pathname,
        query: url.search,
        lifecycle: 'started',
        inFlightAtStart: inFlight,
        inFlightAtSettle: null,
        responseStatus: null,
        bodyOutcome: 'not-observed',
        allowed: false,
        forbidden: false,
        postSeal: sealed,
      };
      record.allowed = record.sameOrigin && allowlist.some((rule) => matchesRule(record, rule));
      record.forbidden = record.sameOrigin && record.path.startsWith('/api/') && !record.allowed;
      records.push(record);
      const key = requestKey(url, method);
      const queue = fallbackByKey.get(key) ?? [];
      queue.push(record);
      fallbackByKey.set(key, queue);
      if (request && typeof request === 'object') byRequest.set(request, record);
      inFlight += 1;
      if (sealed) postSealActivity.push(record);
    } catch (error) {
      failListener(error);
    }
  }

  function settle(request, lifecycle) {
    const record = findRecord(request);
    if (!record) {
      failListener(new Error('request_observer:unmatched-lifecycle'));
      return;
    }
    if (record.lifecycle !== 'started') return;
    record.lifecycle = lifecycle;
    inFlight = Math.max(0, inFlight - 1);
    record.inFlightAtSettle = inFlight;
  }

  function observeResponse(response) {
    const record = findRecord(response);
    if (!record) {
      failListener(new Error('request_observer:unmatched-response'));
      return;
    }
    record.responseStatus = response.status();
    const parse = async () => {
      try {
        const body = await response.json();
        record.bodyOutcome = 'parsed';
        if (parseBody) await parseBody(record, body);
      } catch (error) {
        record.bodyOutcome = 'parse-rejected';
        record.bodyError = String(error);
      }
    };
    const pending = parse();
    bodyPromises.add(pending);
    void pending.finally(() => bodyPromises.delete(pending));
  }

  function attach() {
    if (!page || typeof page.on !== 'function') {
      throw new PageObserverIncompleteError('listener-unavailable');
    }
    try {
      page.on('request', observeRequest);
      page.on('response', observeResponse);
      page.on('requestfinished', (request) => settle(request, 'finished'));
      page.on('requestfailed', (request) => settle(request, 'failed'));
      attached = true;
    } catch (error) {
      throw new PageObserverIncompleteError('listener-unavailable', { cause: error });
    }
    return observer;
  }

  async function seal({ domStable = async () => true } = {}) {
    if (!attached) throw new PageObserverIncompleteError('listener-unavailable');
    const deadline = Date.now() + timeoutMs;
    let quiet = 0;
    while (quiet < quietTurns) {
      if (Date.now() >= deadline)
        throw new PageObserverIncompleteError('timeout-or-pending', { inFlight });
      const stable = await domStable();
      await Promise.allSettled([...bodyPromises]);
      if (!stable || inFlight !== 0 || bodyPromises.size !== 0) quiet = 0;
      else quiet += 1;
      await quietTurn();
    }
    if (inFlight !== 0 || bodyPromises.size !== 0)
      throw new PageObserverIncompleteError('pending-at-seal', { inFlight, bodyPending: bodyPromises.size });
    sealed = true;
    await new Promise((resolve) => setTimeout(resolve, postSealGuardMs));
    if (postSealActivity.length > 0)
      throw new PageObserverIncompleteError('post-seal-activity', { records: postSealActivity.slice() });
    if (listenerErrors.length > 0)
      throw new PageObserverIncompleteError('listener-error', { errors: listenerErrors.slice() });
    return snapshot();
  }

  function responseCounts() {
    const counts = new Map();
    for (const record of records) {
      if (record.lifecycle !== 'finished' && record.lifecycle !== 'failed') continue;
      const key = requestKey({ pathname: record.path, search: record.query }, record.method);
      counts.set(key, (counts.get(key) ?? 0) + (record.lifecycle === 'finished' ? 1 : 0));
    }
    return counts;
  }

  function assertResponseCounts(expected) {
    if (!sealed) throw new PageObserverIncompleteError('counts-before-seal');
    const actual = responseCounts();
    for (const [key, count] of Object.entries(expected)) {
      if ((actual.get(key) ?? 0) !== count)
        return { ok: false, reason: `response-count:${key}:${actual.get(key) ?? 0}:${count}` };
    }
    for (const [key, count] of actual) {
      if (!(key in expected) && count !== 0)
        return { ok: false, reason: `unexpected-response:${key}:${count}` };
    }
    return { ok: true };
  }

  function verdict({
    expectedResponseCounts,
    domMismatch = false,
    expectedScenarios,
    actualScenarios,
    cleanup,
  } = {}) {
    if (!sealed || inFlight !== 0 || bodyPromises.size !== 0)
      return { verdict: OBSERVER_MISSING, reason: 'observer-incomplete' };
    if (listenerErrors.length > 0 || postSealActivity.length > 0)
      return { verdict: OBSERVER_MISSING, reason: 'observer-incomplete' };
    if (records.some((record) => record.forbidden || record.bodyOutcome === 'parse-rejected'))
      return { verdict: OBSERVER_FAIL, reason: 'forbidden-or-malformed-observed' };
    if (expectedResponseCounts) {
      const counts = assertResponseCounts(expectedResponseCounts);
      if (!counts.ok) return { verdict: OBSERVER_FAIL, reason: counts.reason };
    }
    if (domMismatch) return { verdict: OBSERVER_FAIL, reason: 'dom-mismatch' };
    if (expectedScenarios !== undefined && actualScenarios !== undefined) {
      const expected = [...expectedScenarios].sort().join('|');
      const actual = [...actualScenarios].sort().join('|');
      if (expected !== actual)
        return { verdict: OBSERVER_MISSING, reason: 'scenario-set-mismatch' };
    }
    if (cleanup && !cleanup.complete)
      return {
        verdict: cleanup.residual ? OBSERVER_FAIL : OBSERVER_MISSING,
        reason: cleanup.residual ? 'owned-process-residual' : 'cleanup-incomplete',
      };
    return { verdict: OBSERVER_COMPLETE };
  }

  function snapshot() {
    return {
      attached,
      sealed,
      generation,
      inFlight,
      records: records.slice(),
      listenerErrors: listenerErrors.slice(),
      postSealActivity: postSealActivity.slice(),
      bodyPending: bodyPromises.size,
    };
  }

  const observer = { attach, seal, snapshot, assertResponseCounts, responseCounts, verdict };
  return observer;
}
