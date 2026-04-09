import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import http from 'node:http';
import test from 'node:test';

test('js tests preload a no-network guard', async () => {
  assert.equal(globalThis.__ISOCHRONE_TESTS_NETWORK_GUARD_ACTIVE__, true);

  await assert.rejects(
    globalThis.fetch('https://example.test/'),
    /Automatic tests must not make network calls/,
  );
  assert.throws(
    () => http.request('https://example.test/'),
    /Automatic tests must not make network calls/,
  );
  assert.throws(
    () => childProcess.spawn('curl', ['https://example.test/']),
    /Automatic tests must not make network calls/,
  );
});
