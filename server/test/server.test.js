import test from 'node:test';
import assert from 'node:assert/strict';

test('runtime provides fetch and timeout signals', () => {
  assert.equal(typeof fetch, 'function');
  assert.equal(typeof AbortSignal.timeout, 'function');
});

