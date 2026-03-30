import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDefaultMapViewport,
  mapScreenCanvasPixelToGraphPixel,
  panMapViewportByCanvasDelta,
  zoomMapViewportAtCanvasPixel,
} from '../src/core/viewport.js';

function createGraphHeader() {
  return {
    gridWidthPx: 400,
    gridHeightPx: 300,
  };
}

test('zoomMapViewportAtCanvasPixel keeps the anchor point fixed in graph space', () => {
  const graphHeader = createGraphHeader();
  const viewport = createDefaultMapViewport();
  const anchorCanvasX = 160;
  const anchorCanvasY = 120;

  const anchorBefore = mapScreenCanvasPixelToGraphPixel(viewport, anchorCanvasX, anchorCanvasY);
  const zoomedViewport = zoomMapViewportAtCanvasPixel(
    graphHeader,
    viewport,
    anchorCanvasX,
    anchorCanvasY,
    2,
  );
  const anchorAfter = mapScreenCanvasPixelToGraphPixel(
    zoomedViewport,
    anchorCanvasX,
    anchorCanvasY,
  );

  assert.deepEqual(zoomedViewport, {
    scale: 2,
    offsetXPx: 80,
    offsetYPx: 60,
  });
  assert.equal(anchorAfter.xPx, anchorBefore.xPx);
  assert.equal(anchorAfter.yPx, anchorBefore.yPx);
});

test('panMapViewportByCanvasDelta follows grab direction and clamps to graph bounds', () => {
  const graphHeader = createGraphHeader();
  const viewport = {
    scale: 2,
    offsetXPx: 80,
    offsetYPx: 60,
  };

  const pannedViewport = panMapViewportByCanvasDelta(graphHeader, viewport, 40, 20);
  assert.deepEqual(pannedViewport, {
    scale: 2,
    offsetXPx: 60,
    offsetYPx: 50,
  });

  const clampedViewport = panMapViewportByCanvasDelta(graphHeader, viewport, -1000, -1000);
  assert.deepEqual(clampedViewport, {
    scale: 2,
    offsetXPx: 200,
    offsetYPx: 150,
  });
});
