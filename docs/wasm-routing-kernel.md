# WASM Routing Kernel Setup

This document tracks the initial WASM groundwork for performance-critical routing code.

## Scope of this setup

- Introduce a dedicated Rust crate for routing hot-path kernels:
  - `wasm/routing-kernel/Cargo.toml`
  - `wasm/routing-kernel/src/lib.rs`
- Expose a first low-level kernel export:
  - `precompute_edge_costs(...)`
- Provide a repeatable build script:
  - `wasm/build-routing-kernel.sh`
- Provide JS-side module loading and export validation:
  - `web/src/wasm/routing-kernel.js`

No runtime behavior has been switched to WASM yet. Current app behavior remains JS-only.

## Why this shape

- The current profiling shows route expansion dominates runtime.
- A clean ABI boundary is required before moving compute kernels into WASM.
- Edge-cost precomputation is a safe first kernel because it is deterministic and array-oriented.

## Build command

```bash
./wasm/build-routing-kernel.sh
```

Expected output:
- `web/wasm/routing-kernel.wasm`

If `wasm32-unknown-unknown` stdlib is missing, the script fails fast with install guidance.

## Next integration milestones (not implemented yet)

1. Allocate typed-array views in WASM memory and benchmark JS-to-WASM transfer overhead.
2. Add side-by-side benchmark mode (`js` vs `wasm`) for `precompute_edge_costs`.
3. If transfer overhead is acceptable, move additional kernels (batch edge relaxations / heap operations) behind the same interface.
4. Keep parity tests for JS and WASM outputs before any default runtime switch.
