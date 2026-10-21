import test from 'node:test';
import assert from 'node:assert/strict';
import { createGpuhubClient } from '../src/gpuhub.js';

test('gpuhub client uses auth token and default base', async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return { ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify({ code: 'Success', data: { ok: true } }) };
  };
  try {
    const client = createGpuhubClient({ token: 'tok' });
    const result = await client.listDeployments({ page_index: 1, page_size: 2 });
    assert.equal(captured.url, 'https://api.gpuhub.com/api/v1/dev/deployment/list');
    assert.equal(captured.init.headers.Authorization, 'tok');
    assert.equal(result.data.ok, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
