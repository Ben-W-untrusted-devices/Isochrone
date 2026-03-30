const DEFAULT_MAX_VIEWPORT_SCALE = 8;
const DEFAULT_MIN_VIEWPORT_SCALE = 1;

export function createDefaultMapViewport() {
  return {
    scale: 1,
    offsetXPx: 0,
    offsetYPx: 0,
  };
}

export function normalizeMapViewport(graphHeader, viewport = null, options = {}) {
  validateGraphViewportHeader(graphHeader);

  const minScale = Number.isFinite(options.minScale) ? options.minScale : DEFAULT_MIN_VIEWPORT_SCALE;
  const maxScale = Number.isFinite(options.maxScale) ? options.maxScale : DEFAULT_MAX_VIEWPORT_SCALE;
  if (!(minScale > 0) || !(maxScale >= minScale)) {
    throw new Error('viewport scale bounds are invalid');
  }

  const sourceViewport =
    viewport && typeof viewport === 'object' ? viewport : createDefaultMapViewport();
  const scale = clamp(asFiniteOrFallback(sourceViewport.scale, 1), minScale, maxScale);
  const visibleWidthPx = graphHeader.gridWidthPx / scale;
  const visibleHeightPx = graphHeader.gridHeightPx / scale;
  const maxOffsetXPx = Math.max(0, graphHeader.gridWidthPx - visibleWidthPx);
  const maxOffsetYPx = Math.max(0, graphHeader.gridHeightPx - visibleHeightPx);

  return {
    scale,
    offsetXPx: clamp(asFiniteOrFallback(sourceViewport.offsetXPx, 0), 0, maxOffsetXPx),
    offsetYPx: clamp(asFiniteOrFallback(sourceViewport.offsetYPx, 0), 0, maxOffsetYPx),
  };
}

export function mapScreenCanvasPixelToGraphPixel(viewport, screenCanvasX, screenCanvasY) {
  const normalizedViewport = validateViewport(viewport);
  if (!Number.isFinite(screenCanvasX) || !Number.isFinite(screenCanvasY)) {
    throw new Error('screenCanvasX and screenCanvasY must be finite numbers');
  }

  return {
    xPx: normalizedViewport.offsetXPx + screenCanvasX / normalizedViewport.scale,
    yPx: normalizedViewport.offsetYPx + screenCanvasY / normalizedViewport.scale,
  };
}

export function panMapViewportByCanvasDelta(graphHeader, viewport, deltaCanvasX, deltaCanvasY, options = {}) {
  if (!Number.isFinite(deltaCanvasX) || !Number.isFinite(deltaCanvasY)) {
    throw new Error('deltaCanvasX and deltaCanvasY must be finite numbers');
  }
  const normalizedViewport = normalizeMapViewport(graphHeader, viewport, options);
  return normalizeMapViewport(
    graphHeader,
    {
      scale: normalizedViewport.scale,
      offsetXPx: normalizedViewport.offsetXPx - deltaCanvasX / normalizedViewport.scale,
      offsetYPx: normalizedViewport.offsetYPx - deltaCanvasY / normalizedViewport.scale,
    },
    options,
  );
}

export function zoomMapViewportAtCanvasPixel(
  graphHeader,
  viewport,
  anchorCanvasX,
  anchorCanvasY,
  zoomFactor,
  options = {},
) {
  if (!Number.isFinite(anchorCanvasX) || !Number.isFinite(anchorCanvasY)) {
    throw new Error('anchorCanvasX and anchorCanvasY must be finite numbers');
  }
  if (!Number.isFinite(zoomFactor) || zoomFactor <= 0) {
    throw new Error('zoomFactor must be a positive finite number');
  }

  const normalizedViewport = normalizeMapViewport(graphHeader, viewport, options);
  const anchorGraphPx = mapScreenCanvasPixelToGraphPixel(
    normalizedViewport,
    anchorCanvasX,
    anchorCanvasY,
  );
  const nextScale = normalizedViewport.scale * zoomFactor;
  return normalizeMapViewport(
    graphHeader,
    {
      scale: nextScale,
      offsetXPx: anchorGraphPx.xPx - anchorCanvasX / nextScale,
      offsetYPx: anchorGraphPx.yPx - anchorCanvasY / nextScale,
    },
    options,
  );
}

function validateGraphViewportHeader(graphHeader) {
  if (!graphHeader || typeof graphHeader !== 'object') {
    throw new Error('graphHeader is required');
  }
  if (!Number.isFinite(graphHeader.gridWidthPx) || graphHeader.gridWidthPx <= 0) {
    throw new Error('graphHeader.gridWidthPx must be positive');
  }
  if (!Number.isFinite(graphHeader.gridHeightPx) || graphHeader.gridHeightPx <= 0) {
    throw new Error('graphHeader.gridHeightPx must be positive');
  }
}

function validateViewport(viewport) {
  if (!viewport || typeof viewport !== 'object') {
    throw new Error('viewport is required');
  }
  if (!Number.isFinite(viewport.scale) || viewport.scale <= 0) {
    throw new Error('viewport.scale must be positive');
  }
  if (!Number.isFinite(viewport.offsetXPx) || !Number.isFinite(viewport.offsetYPx)) {
    throw new Error('viewport offsets must be finite');
  }
  return viewport;
}

function asFiniteOrFallback(value, fallbackValue) {
  return Number.isFinite(value) ? value : fallbackValue;
}

function clamp(value, minValue, maxValue) {
  if (value < minValue) {
    return minValue;
  }
  if (value > maxValue) {
    return maxValue;
  }
  return value;
}
