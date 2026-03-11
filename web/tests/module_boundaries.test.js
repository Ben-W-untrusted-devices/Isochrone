import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MinHeap as AppMinHeap,
  computeEdgeTraversalCostSeconds as appComputeEdgeTraversalCostSeconds,
  createWalkingSearchState as appCreateWalkingSearchState,
  mapCanvasPixelToGraphMeters as appMapCanvasPixelToGraphMeters,
  mapClientPointToCanvasPixel as appMapClientPointToCanvasPixel,
  parseNodeIndexFromLocationSearch as appParseNodeIndexFromLocationSearch,
  persistNodeIndexToLocation as appPersistNodeIndexToLocation,
  runMinHeapSelfTest as appRunMinHeapSelfTest,
  timeToColour as appTimeToColour,
} from '../src/app.js';
import { MinHeap, runMinHeapSelfTest } from '../src/core/heap.js';
import {
  computeEdgeTraversalCostSeconds,
  createWalkingSearchState,
} from '../src/core/routing.js';
import {
  mapCanvasPixelToGraphMeters,
  mapClientPointToCanvasPixel,
  parseNodeIndexFromLocationSearch,
  persistNodeIndexToLocation,
} from '../src/core/coords.js';
import {
  getAllowedModeMaskFromShell,
  getColourCycleMinutesFromShell,
  initializeAppShell,
} from '../src/ui/orchestration.js';
import { bindCanvasClickRouting } from '../src/interaction/canvas-routing.js';
import {
  CYCLE_COLOUR_MAP_GLSL,
  DEFAULT_COLOUR_CYCLE_MINUTES,
  timeToColour,
} from '../src/render/colour.js';

test('app re-exports heap module symbols', () => {
  assert.equal(AppMinHeap, MinHeap);
  assert.equal(appRunMinHeapSelfTest, runMinHeapSelfTest);
});

test('app re-exports routing module symbols', () => {
  assert.equal(appCreateWalkingSearchState, createWalkingSearchState);
  assert.equal(appComputeEdgeTraversalCostSeconds, computeEdgeTraversalCostSeconds);
});

test('app re-exports coordinate module symbols', () => {
  assert.equal(appMapCanvasPixelToGraphMeters, mapCanvasPixelToGraphMeters);
  assert.equal(appMapClientPointToCanvasPixel, mapClientPointToCanvasPixel);
  assert.equal(appParseNodeIndexFromLocationSearch, parseNodeIndexFromLocationSearch);
  assert.equal(appPersistNodeIndexToLocation, persistNodeIndexToLocation);
});

test('app re-exports colour module symbols', () => {
  assert.equal(appTimeToColour, timeToColour);
  assert.equal(DEFAULT_COLOUR_CYCLE_MINUTES, 60);
  assert.ok(CYCLE_COLOUR_MAP_GLSL.includes('mapCycleColour'));
});

test('ui/input orchestration modules export expected entrypoints', async () => {
  const app = await import('../src/app.js');

  assert.equal(typeof initializeAppShell, 'function');
  assert.equal(typeof getAllowedModeMaskFromShell, 'function');
  assert.equal(typeof getColourCycleMinutesFromShell, 'function');
  assert.equal(typeof bindCanvasClickRouting, 'function');

  // Pure shell helpers are direct re-exports from app.js after split.
  assert.equal(app.initializeAppShell, initializeAppShell);
  assert.equal(app.getAllowedModeMaskFromShell, getAllowedModeMaskFromShell);
  assert.equal(app.getColourCycleMinutesFromShell, getColourCycleMinutesFromShell);
  assert.equal(typeof app.bindCanvasClickRouting, 'function');
});
