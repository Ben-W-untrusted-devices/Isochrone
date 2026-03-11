import assert from 'node:assert/strict';
import test from 'node:test';

import { bindCanvasClickRouting } from '../src/interaction/canvas-routing.js';

function createCanvasStub() {
  return {
    addEventListener() {},
    removeEventListener() {},
  };
}

function flushTasks() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

test('requestIsochroneRedraw reruns from the last completed node', async () => {
  const shell = {
    isochroneCanvas: createCanvasStub(),
  };
  const mapData = {
    graph: {
      header: {
        nNodes: 16,
      },
    },
  };

  let runCount = 0;
  const binding = bindCanvasClickRouting(shell, mapData, {}, {
    findNearestNodeForCanvasPixel() {
      return { nodeIndex: 7 };
    },
    getAllowedModeMaskFromShell() {
      return 4;
    },
    getColourCycleMinutesFromShell() {
      return 75;
    },
    mapClientPointToCanvasPixel() {
      return { xPx: 10, yPx: 12 };
    },
    parseNodeIndexFromLocationSearch() {
      return null;
    },
    persistNodeIndexToLocation() {},
    renderIsochroneLegendIfNeeded() {},
    async runWalkingIsochroneFromSourceNode() {
      runCount += 1;
      return { cancelled: false };
    },
    setRoutingStatus() {},
  });

  await binding.runFromCanvasPixel(10, 12);
  assert.equal(runCount, 1);

  const requested = binding.requestIsochroneRedraw();
  assert.equal(requested, true);
  await flushTasks();
  assert.equal(runCount, 2);
});

test('waitForIdle resolves after active routing run completes', async () => {
  const shell = {
    isochroneCanvas: createCanvasStub(),
  };
  const mapData = {
    graph: {
      header: {
        nNodes: 16,
      },
    },
  };

  let resolveRun = null;
  const binding = bindCanvasClickRouting(shell, mapData, {}, {
    findNearestNodeForCanvasPixel() {
      return { nodeIndex: 7 };
    },
    getAllowedModeMaskFromShell() {
      return 4;
    },
    getColourCycleMinutesFromShell() {
      return 75;
    },
    mapClientPointToCanvasPixel() {
      return { xPx: 10, yPx: 12 };
    },
    parseNodeIndexFromLocationSearch() {
      return null;
    },
    persistNodeIndexToLocation() {},
    renderIsochroneLegendIfNeeded() {},
    runWalkingIsochroneFromSourceNode() {
      return new Promise((resolve) => {
        resolveRun = resolve;
      });
    },
    setRoutingStatus() {},
  });

  const runPromise = binding.runFromCanvasPixel(10, 12);
  let idleResolved = false;
  const idlePromise = binding.waitForIdle().then(() => {
    idleResolved = true;
  });

  await flushTasks();
  assert.equal(idleResolved, false);

  resolveRun({ cancelled: false });
  await runPromise;
  await idlePromise;
  assert.equal(idleResolved, true);
});
