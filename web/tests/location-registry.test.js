import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildLocationAssetUrls,
  createDefaultLocationRegistry,
  findLocationById,
  loadLocationRegistry,
  parseLocationRegistry,
  resolveLocationEntry,
} from '../src/core/location-registry.js';

test('parseLocationRegistry accepts valid location registry payloads', () => {
  const registry = parseLocationRegistry({
    locations: [
      {
        id: 'berlin',
        name: 'Berlin',
        graphFileName: 'berlin-routing.graph.bin.gz',
        boundaryFileName: 'berlin-boundaries.canvas.json',
      },
      {
        id: 'paris',
        name: 'Paris',
        graphFileName: 'paris-routing.graph.bin.gz',
        boundaryFileName: 'paris-boundaries.canvas.json',
      },
    ],
  });

  assert.deepEqual(registry, {
    locations: [
      {
        id: 'berlin',
        name: 'Berlin',
        graphFileName: 'berlin-routing.graph.bin.gz',
        boundaryFileName: 'berlin-boundaries.canvas.json',
      },
      {
        id: 'paris',
        name: 'Paris',
        graphFileName: 'paris-routing.graph.bin.gz',
        boundaryFileName: 'paris-boundaries.canvas.json',
      },
    ],
  });
});

test('parseLocationRegistry rejects duplicate location ids', () => {
  assert.throws(
    () => parseLocationRegistry({
      locations: [
        {
          id: 'berlin',
          name: 'Berlin',
          graphFileName: 'berlin-routing.graph.bin.gz',
          boundaryFileName: 'berlin-boundaries.canvas.json',
        },
        {
          id: 'berlin',
          name: 'Berlin Duplicate',
          graphFileName: 'berlin-duplicate-routing.graph.bin.gz',
          boundaryFileName: 'berlin-duplicate-boundaries.canvas.json',
        },
      ],
    }),
    /duplicate location id/i,
  );
});

test('resolveLocationEntry returns matching location and falls back when missing', () => {
  const registry = parseLocationRegistry({
    locations: [
      {
        id: 'berlin',
        name: 'Berlin',
        graphFileName: 'berlin-routing.graph.bin.gz',
        boundaryFileName: 'berlin-boundaries.canvas.json',
      },
      {
        id: 'paris',
        name: 'Paris',
        graphFileName: 'paris-routing.graph.bin.gz',
        boundaryFileName: 'paris-boundaries.canvas.json',
      },
    ],
  });

  assert.deepEqual(findLocationById(registry, 'paris'), {
    id: 'paris',
    name: 'Paris',
    graphFileName: 'paris-routing.graph.bin.gz',
    boundaryFileName: 'paris-boundaries.canvas.json',
  });
  assert.deepEqual(resolveLocationEntry(registry, 'berlin'), {
    id: 'berlin',
    name: 'Berlin',
    graphFileName: 'berlin-routing.graph.bin.gz',
    boundaryFileName: 'berlin-boundaries.canvas.json',
  });
  assert.deepEqual(resolveLocationEntry(registry, 'madrid', 'paris'), {
    id: 'paris',
    name: 'Paris',
    graphFileName: 'paris-routing.graph.bin.gz',
    boundaryFileName: 'paris-boundaries.canvas.json',
  });
});

test('createDefaultLocationRegistry returns Berlin default entry', () => {
  assert.deepEqual(createDefaultLocationRegistry(), {
    locations: [
      {
        id: 'berlin',
        name: 'Berlin',
        graphFileName: 'graph-walk.bin.gz',
        boundaryFileName: 'berlin-district-boundaries-canvas.json',
      },
    ],
  });
});

test('committed locations.json matches the validated registry shape', async () => {
  const registryJson = await readFile(new URL('../src/data/locations.json', import.meta.url), 'utf8');
  const parsed = parseLocationRegistry(JSON.parse(registryJson));

  assert.deepEqual(parsed, {
    locations: [
      {
        id: 'berlin',
        name: 'Berlin',
        graphFileName: 'graph-walk.bin.gz',
        boundaryFileName: 'berlin-district-boundaries-canvas.json',
      },
    ],
  });
});

test('buildLocationAssetUrls resolves graph and boundary fetch URLs from file names', () => {
  assert.deepEqual(
    buildLocationAssetUrls({
      id: 'berlin',
      name: 'Berlin',
      graphFileName: 'graph-walk.bin.gz',
      boundaryFileName: 'berlin-district-boundaries-canvas.json',
    }),
    {
      graphUrl: '../data_pipeline/output/graph-walk.bin.gz',
      boundaryUrl: '../data_pipeline/output/berlin-district-boundaries-canvas.json',
    },
  );
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
              {
                id: 'berlin',
                name: 'Berlin',
                graphFileName: 'graph-walk.bin.gz',
                boundaryFileName: 'berlin-district-boundaries-canvas.json',
              },
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
      {
        id: 'berlin',
        name: 'Berlin',
        graphFileName: 'graph-walk.bin.gz',
        boundaryFileName: 'berlin-district-boundaries-canvas.json',
      },
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
