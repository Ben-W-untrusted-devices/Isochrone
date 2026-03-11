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
