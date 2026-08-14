import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  createRequestLedger,
  RequestLedgerIncompleteError,
} from './c3-e8-request-ledger.mjs';

function response(status = 200) {
  return { status };
}

describe('C3/E8 request ledger', () => {
  it('seals only after settled requests and two quiet turns', async () => {
    const calls = [];
    const ledger = createRequestLedger(async (input, init) => {
      calls.push([input, init]);
      return response();
    });
    await ledger.fetch('/api/works', { method: 'GET' });
    const snapshot = await ledger.seal();
    assert.equal(snapshot.sealed, true);
    assert.equal(snapshot.generation, 1);
    assert.equal(snapshot.inFlight, 0);
    assert.equal(snapshot.records[0].lifecycle, 'settled');
    assert.equal(snapshot.records[0].path, '/api/works');
    assert.equal(calls.length, 1);
  });

  it('observes late forbidden activity after seal and fails incomplete', async () => {
    let release;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const ledger = createRequestLedger(
      async (input) => (String(input) === '/api/works' ? response() : pending),
      { postSealGuardMs: 30 },
    );
    await ledger.fetch('/api/works');
    const sealing = ledger.seal();
    setTimeout(() => {
      void ledger.fetch('/api/works/work-1/runs');
      release(response());
    }, 10);
    await assert.rejects(sealing, (error) => {
      assert(error instanceof RequestLedgerIncompleteError);
      assert.equal(error.reason, 'post-seal-activity');
      assert.equal(error.details.records[0].path, '/api/works/work-1/runs');
      return true;
    });
  });

  it('does not seal a never-settling request', async () => {
    const ledger = createRequestLedger(() => new Promise(() => {}), {
      timeoutMs: 25,
    });
    void ledger.fetch('/api/works');
    await assert.rejects(ledger.seal(), (error) => {
      assert(error instanceof RequestLedgerIncompleteError);
      assert.equal(error.reason, 'timeout-or-pending');
      assert.equal(error.details.inFlight, 1);
      return true;
    });
    assert.equal(ledger.snapshot().sealed, false);
  });
});
