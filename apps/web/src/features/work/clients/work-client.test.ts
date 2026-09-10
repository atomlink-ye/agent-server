import { afterEach, expect, it, vi } from 'vitest';
import { WorkClient } from './work-client';
import { apiTransport } from '../../../api/transport';

const workId = '00000000-0000-4000-8000-000000000100';
const runId = '00000000-0000-4000-8000-000000000200';
const message = {
  id: runId,
  work_run_id: runId,
  sequence: 1,
  role: 'user',
  body: 'hello',
  status: 'queued',
  reply_to_message_id: null,
  failure_code: null,
  created_at: '2026-09-10T00:00:00.000Z',
};
afterEach(() => vi.restoreAllMocks());
it('uses the Run-scoped browser routes for reads, writes, and retries', async () => {
  const request = vi.spyOn(apiTransport, 'request');
  const client = new WorkClient();
  request.mockResolvedValueOnce({
    work_id: workId,
    work_run_id: runId,
    messages: [],
    preparation: null,
  });
  await client.chat(workId, runId);
  expect(request.mock.calls[0]?.[0]).toBe(
    `/api/works/${workId}/runs/${runId}/chat`,
  );
  request.mockResolvedValueOnce({ message, replayed: false });
  await client.postChat(workId, 'hello', 'key', runId);
  expect(request.mock.calls[1]?.[0]).toBe(
    `/api/works/${workId}/runs/${runId}/chat`,
  );
  request.mockResolvedValueOnce({ message });
  await client.retryChat(workId, message.id, runId);
  expect(request.mock.calls[2]?.[0]).toBe(
    `/api/works/${workId}/runs/${runId}/chat/${message.id}/retry`,
  );
});
