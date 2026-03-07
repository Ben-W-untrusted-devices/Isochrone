import { describe, expect, it } from 'vitest';

import {
  createBoundaryCanvasTransform,
  drawBoundaryBasemap,
  initializeAppShell,
  loadAndRenderBoundaryBasemap,
  mapBoundaryPathToCanvas,
  minutesToSeconds,
  parseBoundaryBasemapPayload,
} from '../src/app.js';

const SAMPLE_BOUNDARY_PAYLOAD = {
  coordinate_space: {
    width: 100,
    height: 50,
  },
  features: [
    {
      relation_id: 1,
      name: 'Mitte',
      paths: [
        [
          [0, 0],
          [100, 0],
          [100, 50],
          [0, 50],
          [0, 0],
        ],
      ],
    },
  ],
};

function createFakeContext() {
  return {
    clearRectCalls: 0,
    beginPathCalls: 0,
    moveToCalls: 0,
    lineToCalls: 0,
    closePathCalls: 0,
    fillCalls: 0,
    strokeCalls: 0,
    clearRect() {
      this.clearRectCalls += 1;
    },
    beginPath() {
      this.beginPathCalls += 1;
    },
    moveTo() {
      this.moveToCalls += 1;
    },
    lineTo() {
      this.lineToCalls += 1;
    },
    closePath() {
      this.closePathCalls += 1;
    },
    fill() {
      this.fillCalls += 1;
    },
    stroke() {
      this.strokeCalls += 1;
    },
  };
}

describe('minutesToSeconds', () => {
  it('converts integer minutes', () => {
    expect(minutesToSeconds(3)).toBe(180);
  });

  it('rounds to nearest second for fractional minutes', () => {
    expect(minutesToSeconds(1.25)).toBe(75);
  });

  it('rejects negative values', () => {
    expect(() => minutesToSeconds(-1)).toThrow('minutes must be non-negative');
  });
});

describe('initializeAppShell', () => {
  it('wires required shell elements and sets loading text', () => {
    const map = {
      tagName: 'CANVAS',
      width: 1,
      height: 1,
      getBoundingClientRect() {
        return { width: 400, height: 200 };
      },
    };
    const boundaries = {
      tagName: 'CANVAS',
      width: 1,
      height: 1,
      getBoundingClientRect() {
        return { width: 400, height: 200 };
      },
    };
    const loading = { tagName: 'DIV', textContent: '' };
    const fakeDocument = {
      getElementById(id) {
        if (id === 'map') return map;
        if (id === 'boundaries') return boundaries;
        if (id === 'loading') return loading;
        return null;
      },
    };

    const result = initializeAppShell(fakeDocument);

    expect(result.mapCanvas).toBe(map);
    expect(result.boundaryCanvas).toBe(boundaries);
    expect(result.loadingOverlay).toBe(loading);
    expect(loading.textContent).toBe('Loading district boundaries...');
    expect(map.width).toBe(400);
    expect(boundaries.height).toBe(200);
  });

  it('throws if the boundaries canvas is missing', () => {
    const fakeDocument = {
      getElementById(id) {
        if (id === 'map') return { tagName: 'CANVAS' };
        if (id === 'loading') return { tagName: 'DIV' };
        return null;
      },
    };

    expect(() => initializeAppShell(fakeDocument)).toThrow(
      'index.html is missing <canvas id="boundaries">',
    );
  });
});

describe('boundary basemap parsing and mapping', () => {
  it('parses payload and validates paths', () => {
    const parsed = parseBoundaryBasemapPayload(SAMPLE_BOUNDARY_PAYLOAD);

    expect(parsed.coordinateSpace.width).toBe(100);
    expect(parsed.coordinateSpace.height).toBe(50);
    expect(parsed.features).toHaveLength(1);
    expect(parsed.features[0].paths[0]).toHaveLength(5);
  });

  it('maps boundary paths into canvas coordinates', () => {
    const transform = createBoundaryCanvasTransform({ width: 100, height: 50 }, 200, 200);
    const mapped = mapBoundaryPathToCanvas(
      [
        [0, 0],
        [100, 50],
      ],
      transform,
    );

    expect(mapped[0][0]).toBe(0);
    expect(mapped[0][1]).toBe(50);
    expect(mapped[1][0]).toBe(200);
    expect(mapped[1][1]).toBe(150);
  });
});

describe('drawBoundaryBasemap', () => {
  it('draws paths onto the boundary canvas context', () => {
    const context = createFakeContext();
    const boundaryCanvas = {
      width: 200,
      height: 100,
      getContext(kind) {
        if (kind === '2d') {
          return context;
        }
        return null;
      },
    };

    const summary = drawBoundaryBasemap(boundaryCanvas, SAMPLE_BOUNDARY_PAYLOAD);

    expect(summary.featureCount).toBe(1);
    expect(summary.pathCount).toBe(1);
    expect(context.clearRectCalls).toBe(1);
    expect(context.beginPathCalls).toBe(1);
    expect(context.moveToCalls).toBe(1);
    expect(context.lineToCalls).toBe(4);
    expect(context.closePathCalls).toBe(1);
    expect(context.fillCalls).toBe(1);
    expect(context.strokeCalls).toBe(1);
  });
});

describe('loadAndRenderBoundaryBasemap', () => {
  it('loads payload, renders boundaries, and advances loading text', async () => {
    const context = createFakeContext();
    const shell = {
      boundaryCanvas: {
        width: 200,
        height: 100,
        getContext() {
          return context;
        },
      },
      loadingOverlay: {
        textContent: '',
      },
    };

    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      async json() {
        return SAMPLE_BOUNDARY_PAYLOAD;
      },
    });

    const summary = await loadAndRenderBoundaryBasemap(shell, {
      url: '/boundaries.json',
      fetchImpl,
    });

    expect(summary.pathCount).toBe(1);
    expect(shell.loadingOverlay.textContent).toBe('Loading graph...');
  });

  it('sets failure text when fetch fails', async () => {
    const shell = {
      boundaryCanvas: {
        width: 200,
        height: 100,
        getContext() {
          return createFakeContext();
        },
      },
      loadingOverlay: {
        textContent: '',
      },
    };

    const fetchImpl = async () => ({
      ok: false,
      status: 500,
      async json() {
        return {};
      },
    });

    await expect(
      loadAndRenderBoundaryBasemap(shell, {
        url: '/boundaries.json',
        fetchImpl,
      }),
    ).rejects.toThrow('failed to fetch district boundaries: HTTP 500');

    expect(shell.loadingOverlay.textContent).toBe('Failed to load district boundaries.');
  });
});
