import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createWasmRoutingKernelFacade,
  hasWebAssemblySupport,
  instantiateRoutingKernelWasm,
  validateRoutingKernelExports,
} from '../src/wasm/routing-kernel.js';

test('hasWebAssemblySupport checks runtime feature availability', () => {
  assert.equal(hasWebAssemblySupport({}), false);
  assert.equal(hasWebAssemblySupport({ WebAssembly: {} }), true);
});

test('validateRoutingKernelExports rejects missing required exports', () => {
  assert.throws(
    () => validateRoutingKernelExports({}),
    /missing required symbol: memory/,
  );
});

test('createWasmRoutingKernelFacade forwards precompute call to wasm export', () => {
  const calls = [];
  const fakeExports = {
    memory: {},
    precompute_edge_costs(...args) {
      calls.push(args);
    },
  };
  const facade = createWasmRoutingKernelFacade(fakeExports);

  facade.precomputeEdgeCosts({
    outCostSecondsPtr: 1,
    edgeModeMaskPtr: 2,
    edgeRoadClassPtr: 3,
    edgeMaxspeedKphPtr: 4,
    edgeWalkCostSecondsPtr: 5,
    edgeCount: 6,
    allowedModeMask: 7,
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [1, 2, 3, 4, 5, 6, 7]);
});

test('instantiateRoutingKernelWasm uses instantiateStreaming and validates exports', async () => {
  const fakeInstance = {
    exports: {
      memory: {},
      precompute_edge_costs() {},
    },
  };
  let fetchCalls = 0;
  const result = await instantiateRoutingKernelWasm({
    wasmUrl: '/wasm/routing-kernel.wasm',
    fetchImpl: async (url) => {
      fetchCalls += 1;
      assert.equal(url, '/wasm/routing-kernel.wasm');
      return { ok: true };
    },
    webAssemblyObject: {
      async instantiateStreaming() {
        return { instance: fakeInstance, module: { id: 'm' } };
      },
    },
  });

  assert.equal(fetchCalls, 1);
  assert.equal(result.exports, fakeInstance.exports);
});
