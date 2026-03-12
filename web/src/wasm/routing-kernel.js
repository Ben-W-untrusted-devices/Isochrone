const REQUIRED_EXPORTS = ['memory', 'precompute_edge_costs'];

export function hasWebAssemblySupport(runtimeGlobal = globalThis) {
  return Boolean(runtimeGlobal && runtimeGlobal.WebAssembly);
}

export function validateRoutingKernelExports(exportsObject) {
  if (!exportsObject || typeof exportsObject !== 'object') {
    throw new Error('WASM exports object is required');
  }

  for (const exportName of REQUIRED_EXPORTS) {
    if (!(exportName in exportsObject)) {
      throw new Error(`WASM export missing required symbol: ${exportName}`);
    }
  }
}

export async function instantiateRoutingKernelWasm(options = {}) {
  const {
    wasmUrl = '/wasm/routing-kernel.wasm',
    fetchImpl = globalThis.fetch,
    webAssemblyObject = globalThis.WebAssembly,
  } = options;

  if (!hasWebAssemblySupport({ WebAssembly: webAssemblyObject })) {
    throw new Error('WebAssembly is not available in this runtime');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetchImpl must be a function');
  }

  const response = await fetchImpl(wasmUrl);
  if (!response || (typeof response.ok === 'boolean' && !response.ok)) {
    throw new Error(`Failed to fetch WASM module: ${wasmUrl}`);
  }

  let instance;
  let module;
  if (typeof webAssemblyObject.instantiateStreaming === 'function') {
    ({ instance, module } = await webAssemblyObject.instantiateStreaming(response, {}));
  } else {
    const bytes = await response.arrayBuffer();
    ({ instance, module } = await webAssemblyObject.instantiate(bytes, {}));
  }

  validateRoutingKernelExports(instance.exports);
  return {
    module,
    instance,
    exports: instance.exports,
  };
}

export function createWasmRoutingKernelFacade(exportsObject) {
  validateRoutingKernelExports(exportsObject);
  return {
    exports: exportsObject,
    precomputeEdgeCosts({
      outCostSecondsPtr,
      edgeModeMaskPtr,
      edgeRoadClassPtr,
      edgeMaxspeedKphPtr,
      edgeWalkCostSecondsPtr,
      edgeCount,
      allowedModeMask,
    }) {
      exportsObject.precompute_edge_costs(
        outCostSecondsPtr,
        edgeModeMaskPtr,
        edgeRoadClassPtr,
        edgeMaxspeedKphPtr,
        edgeWalkCostSecondsPtr,
        edgeCount,
        allowedModeMask,
      );
    },
  };
}
