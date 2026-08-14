import { strict as assert } from 'node:assert';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import {
  createPageObserver,
  PageObserverIncompleteError,
} from './page-observer.mjs';

function fakePage() {
  const page = new EventEmitter();
  page.on = page.on.bind(page);
  return page;
}

function request(url, method = 'GET') {
  return { url: () => `http://example.test${url}`, method: () => method };
}

function response(req, status, body, parse = true) {
  return {
    request: () => req,
    status: () => status,
    json: parse ? async () => body : async () => { throw new Error('malformed-json'); },
  };
}

const allowlist = [{ method: 'GET', path: '/api/works', query: '' }];

describe('C4 page observer incomplete and fail-closed duals', () => {
  it('requires request, response, finished and sealed lifecycle before counts', async () => {
    const page = fakePage();
    const observer = createPageObserver({ page, origin: 'http://example.test', allowlist });
    observer.attach();
    const req = request('/api/works');
    page.emit('request', req);
    page.emit('response', response(req, 200, { works: [] }));
    page.emit('requestfinished', req);
    const snapshot = await observer.seal();
    assert.equal(snapshot.sealed, true);
    assert.equal(snapshot.records[0].bodyOutcome, 'parsed');
    assert.deepEqual(observer.assertResponseCounts({ 'GET /api/works': 1 }), { ok: true });
  });

  it('marks forbidden method/path and duplicate responses as unsound after seal', async () => {
    const page = fakePage();
    const observer = createPageObserver({ page, origin: 'http://example.test', allowlist });
    observer.attach();
    const first = request('/api/works');
    const duplicate = request('/api/works');
    for (const req of [first, duplicate]) {
      page.emit('request', req);
      page.emit('response', response(req, 200, { works: [] }));
      page.emit('requestfinished', req);
    }
    const snapshot = await observer.seal();
    assert.equal(snapshot.records.filter((record) => record.forbidden).length, 0);
    assert.deepEqual(observer.assertResponseCounts({ 'GET /api/works': 1 }).ok, false);
    const post = request('/api/team-project', 'POST');
    page.emit('request', post);
    assert.equal(observer.snapshot().postSealActivity.length, 1);
    assert.equal(observer.snapshot().records.at(-1).forbidden, true);
  });

  it('returns explicit MISSING for body pending and collector/listener unavailable', async () => {
    const page = fakePage();
    const observer = createPageObserver({ page, origin: 'http://example.test', allowlist, postSealGuardMs: 5 });
    observer.attach();
    const req = request('/api/works');
    page.emit('request', req);
    page.emit('response', response(req, 200, null, false));
    page.emit('requestfinished', req);
    const snapshot = await observer.seal();
    assert.equal(snapshot.records[0].bodyOutcome, 'parse-rejected');
    assert.equal(observer.verdict().verdict, 'UNSOUND_ABSENCE');

    await assert.rejects(
      createPageObserver({ page: {} }).seal(),
      (error) => error instanceof PageObserverIncompleteError && error.reason === 'listener-unavailable',
    );
  });

  it('marks never-settling request as incomplete and catches delayed forbidden activity', async () => {
    const page = fakePage();
    const observer = createPageObserver({
      page,
      origin: 'http://example.test',
      allowlist,
      timeoutMs: 25,
      postSealGuardMs: 20,
    });
    observer.attach();
    const req = request('/api/works');
    page.emit('request', req);
    await assert.rejects(observer.seal(), (error) =>
      error instanceof PageObserverIncompleteError && error.reason === 'timeout-or-pending',
    );

    const secondPage = fakePage();
    const second = createPageObserver({
      page: secondPage,
      origin: 'http://example.test',
      allowlist,
      postSealGuardMs: 30,
    });
    second.attach();
    const initial = request('/api/works');
    secondPage.emit('request', initial);
    secondPage.emit('response', response(initial, 200, { works: [] }));
    secondPage.emit('requestfinished', initial);
    const sealing = second.seal();
    setTimeout(() => secondPage.emit('request', request('/api/team-project')), 10);
    await assert.rejects(sealing, (error) =>
      error instanceof PageObserverIncompleteError && error.reason === 'post-seal-activity',
    );
  });
});
