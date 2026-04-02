import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  createDefaultLocationRegistry,
  findLocationByFileName,
  loadLocationRegistry,
  parseLocationRegistry,
  resolveLocationName,
} from '../src/core/location-registry.js';

test('parseLocationRegistry accepts valid location registry payloads', () => {
  const registry = parseLocationRegistry({
    locations: [
      { name: 'Berlin', fileName: 'berlin' },
      { name: 'Paris', fileName: 'paris' },
    ],
  });

  assert.deepEqual(registry, {
    locations: [
      { name: 'Berlin', fileName: 'berlin' },
      { name: 'Paris', fileName: 'paris' },
    ],
  });
});

test('parseLocationRegistry rejects duplicate machine-readable file names', () => {
  assert.throws(
    () => parseLocationRegistry({
      locations: [
        { name: 'Berlin', fileName: 'berlin' },
        { name: 'Berlin Duplicate', fileName: 'berlin' },
      ],
    }),
    /duplicate location fileName/i,
  );
});

test('resolveLocationName returns matching name and falls back when missing', () => {
  const registry = parseLocationRegistry({
    locations: [
      { name: 'Berlin', fileName: 'berlin' },
      { name: 'Paris', fileName: 'paris' },
    ],
  });

  assert.deepEqual(findLocationByFileName(registry, 'paris'), {
    name: 'Paris',
    fileName: 'paris',
  });
  assert.equal(resolveLocationName(registry, 'berlin', 'Fallback'), 'Berlin');
  assert.equal(resolveLocationName(registry, 'madrid', 'Fallback'), 'Fallback');
});

test('createDefaultLocationRegistry returns Berlin default entry', () => {
  assert.deepEqual(createDefaultLocationRegistry(), {
    locations: [
      { name: 'Berlin', fileName: 'berlin' },
    ],
  });
});

test('committed locations.json matches the validated registry shape', async () => {
  const registryJson = await readFile(new URL('../src/data/locations.json', import.meta.url), 'utf8');
  const parsed = parseLocationRegistry(JSON.parse(registryJson));

  assert.deepEqual(parsed, {
    locations: [
      { name: 'Berlin', fileName: 'berlin' },
    ],
  });
});

test('loadLocationRegistry parses fetched JSON', async () => {
  const requestedUrls = [];
  const registry = await loadLocationRegistry({
    baseUrl: new URL('../src/core/location-registry.js', import.meta.url),
    fetchImpl: async (url) => {
      requestedUrls.push(String(url));
      return {
        ok: true,
        async json() {
          return {
            locations: [
              { name: 'Berlin', fileName: 'berlin' },
            ],
          };
        },
      };
    },
  });

  assert.equal(requestedUrls.length, 1);
  assert.match(requestedUrls[0], /\/data\/locations\.json$/);
  assert.deepEqual(registry, {
    locations: [
      { name: 'Berlin', fileName: 'berlin' },
    ],
  });
});

test('loadLocationRegistry falls back to default registry when fetch fails', async () => {
  const registry = await loadLocationRegistry({
    fetchImpl: async () => {
      throw new Error('network unavailable');
    },
  });

  assert.deepEqual(registry, createDefaultLocationRegistry());
});
