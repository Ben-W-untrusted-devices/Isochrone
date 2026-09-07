import assert from 'node:assert/strict';
import test from 'node:test';

import { collectAllReachableTravelTimeEdgeVertices } from '../src/render/edge-painting.js';
import { EDGE_MODE_CAR_BIT, EDGE_MODE_WALK_BIT } from '../src/config/constants.js';

/**
 * Three nodes in a row, joined by two edges a car may use.
 *
 * Enough to tell whether the collector reads the graph afresh each time or is
 * reusing something it should not be.
 */
function createChainGraph() {
  const nNodes = 3;
  const nEdges = 2;
  const nodeBuffer = new ArrayBuffer(nNodes * 16);
  const edgeBuffer = new ArrayBuffer(nEdges * 12);
  const nodeI32 = new Int32Array(nodeBuffer);
  const nodeU32 = new Uint32Array(nodeBuffer);
  const nodeU16 = new Uint16Array(nodeBuffer);
  const edgeU32 = new Uint32Array(edgeBuffer);

  // node 0 -> edge 0, node 1 -> edge 1, node 2 has none.
  nodeU32[2] = 0;
  nodeU16[6] = 1;
  nodeU32[6] = 1;
  nodeU16[14] = 1;
  nodeU32[10] = 2;
  nodeU16[22] = 0;

  edgeU32[0] = 1;
  edgeU32[3] = 2;

  return {
    header: { nNodes, nEdges, gridWidthPx: 256, gridHeightPx: 256 },
    nodeI32,
    nodeU32,
    nodeU16,
    edgeU32,
    edgeU16: new Uint16Array(edgeBuffer),
    edgeModeMask: Uint8Array.from([EDGE_MODE_CAR_BIT, EDGE_MODE_CAR_BIT]),
    edgeRoadClassId: new Uint8Array(nEdges),
    edgeMaxspeedKph: new Uint16Array(nEdges),
  };
}

const nodePixels = {
  nodePixelX: Uint16Array.of(0, 10, 20),
  nodePixelY: Uint16Array.of(0, 0, 0),
};

test('the travel cost is read fresh, not baked into what the mode can use', () => {
  // Which edges a mode may use is a property of the graph and is kept between
  // runs; what they cost is not, because it changes with the walking and
  // cycling speeds. Folding the cost into the kept list would leave a map that
  // ignored a speed change until the region was reloaded.
  const graph = createChainGraph();
  const distSeconds = Float64Array.of(0, 10, 20);

  // Asked first at a speed that makes the edges free, so nothing is drawable,
  // and then at a speed that does not. An edge left out of the kept list while
  // its cost was zero would never come back.
  const stopped = collectAllReachableTravelTimeEdgeVertices(
    graph, nodePixels, distSeconds, EDGE_MODE_CAR_BIT,
    { edgeTraversalCostSeconds: Float32Array.of(0, 0) },
  );
  const moving = collectAllReachableTravelTimeEdgeVertices(
    graph, nodePixels, distSeconds, EDGE_MODE_CAR_BIT,
    { edgeTraversalCostSeconds: Float32Array.of(10, 10) },
  );

  assert.equal(stopped.length / 6, 0, 'a cost of zero is no edge to draw');
  assert.equal(moving.length / 6, 2, 'both edges come back when they cost something');

  // And the times come from the costs given, not from a previous call.
  assert.equal(moving[2], 0);
  assert.equal(moving[5], 10);
});

test('a second run over the same graph sees the new travel times', () => {
  const graph = createChainGraph();
  const cost = Float32Array.of(10, 10);

  const fromStart = collectAllReachableTravelTimeEdgeVertices(
    graph, nodePixels, Float64Array.of(0, 10, 20), EDGE_MODE_CAR_BIT,
    { edgeTraversalCostSeconds: cost },
  );
  const fromMiddle = collectAllReachableTravelTimeEdgeVertices(
    graph, nodePixels, Float64Array.of(Infinity, 0, 10), EDGE_MODE_CAR_BIT,
    { edgeTraversalCostSeconds: cost },
  );

  assert.equal(fromStart.length / 6, 2);
  assert.equal(fromMiddle.length / 6, 1, 'the first edge starts nowhere reachable');
  assert.equal(fromMiddle[2], 0, 'and the one that remains starts at the new origin');
});

test('a different mode selection gets its own edges', () => {
  const graph = createChainGraph();
  const options = { edgeTraversalCostSeconds: Float32Array.of(10, 10) };
  const distSeconds = Float64Array.of(0, 10, 20);

  const byCar = collectAllReachableTravelTimeEdgeVertices(
    graph, nodePixels, distSeconds, EDGE_MODE_CAR_BIT, options,
  );
  const onFoot = collectAllReachableTravelTimeEdgeVertices(
    graph, nodePixels, distSeconds, EDGE_MODE_WALK_BIT, options,
  );
  const byCarAgain = collectAllReachableTravelTimeEdgeVertices(
    graph, nodePixels, distSeconds, EDGE_MODE_CAR_BIT, options,
  );

  assert.equal(byCar.length / 6, 2);
  assert.equal(onFoot.length / 6, 0, 'these edges are for cars');
  assert.deepEqual(Array.from(byCarAgain), Array.from(byCar), 'and asking again is the same map');
});
