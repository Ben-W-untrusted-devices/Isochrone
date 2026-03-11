import { DEFAULT_COLOUR_CYCLE_MINUTES, timeToColour } from '../render/colour.js';

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function assertPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertDataUrl(value, name) {
  if (typeof value !== 'string' || !value.startsWith('data:image/png')) {
    throw new Error(`${name} must be a PNG data URL`);
  }
}

function assertEdgeVertexData(edgeVertexData) {
  if (!(edgeVertexData instanceof Float32Array)) {
    throw new Error('edgeVertexData must be a Float32Array');
  }
  if (edgeVertexData.length % 6 !== 0) {
    throw new Error('edgeVertexData length must be a multiple of 6');
  }
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatSvgNumber(value) {
  if (!Number.isFinite(value)) {
    return '0';
  }
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

export function buildIsochroneEdgeLineMarkup(edgeVertexData, options = {}) {
  assertEdgeVertexData(edgeVertexData);

  const cycleMinutes = options.cycleMinutes ?? DEFAULT_COLOUR_CYCLE_MINUTES;
  if (!Number.isFinite(cycleMinutes) || cycleMinutes <= 0) {
    throw new Error('cycleMinutes must be a positive number');
  }

  const edgeLines = [];
  for (let i = 0; i < edgeVertexData.length; i += 6) {
    const x0 = edgeVertexData[i];
    const y0 = edgeVertexData[i + 1];
    const t0 = edgeVertexData[i + 2];
    const x1 = edgeVertexData[i + 3];
    const y1 = edgeVertexData[i + 4];
    const t1 = edgeVertexData[i + 5];

    const representativeSeconds =
      Number.isFinite(t0) && Number.isFinite(t1)
        ? Math.max(0, (t0 + t1) * 0.5)
        : Number.isFinite(t0)
          ? Math.max(0, t0)
          : 0;
    const [r, g, b] = timeToColour(representativeSeconds, { cycleMinutes });
    edgeLines.push(
      `<line x1="${formatSvgNumber(x0)}" y1="${formatSvgNumber(y0)}" x2="${formatSvgNumber(x1)}" y2="${formatSvgNumber(y1)}" stroke="rgb(${r}, ${g}, ${b})" stroke-width="1" stroke-linecap="round" vector-effect="non-scaling-stroke" />`,
    );
  }

  return edgeLines.join('\n');
}

export function buildRenderedIsochroneSvgDocument(options = {}) {
  const widthPx = Math.floor(options.widthPx);
  const heightPx = Math.floor(options.heightPx);
  assertPositiveInteger(widthPx, 'widthPx');
  assertPositiveInteger(heightPx, 'heightPx');

  const boundaryLayerDataUrl = options.boundaryLayerDataUrl;
  assertDataUrl(boundaryLayerDataUrl, 'boundaryLayerDataUrl');
  const edgeVertexData = options.edgeVertexData ?? new Float32Array(0);
  assertEdgeVertexData(edgeVertexData);
  const cycleMinutes = options.cycleMinutes ?? DEFAULT_COLOUR_CYCLE_MINUTES;
  if (!Number.isFinite(cycleMinutes) || cycleMinutes <= 0) {
    throw new Error('cycleMinutes must be a positive number');
  }

  const title = typeof options.title === 'string' ? options.title : 'Isochrone export';
  const escapedTitle = escapeXml(title);
  const escapedBoundaryDataUrl = escapeXml(boundaryLayerDataUrl);
  const edgeLines = buildIsochroneEdgeLineMarkup(edgeVertexData, { cycleMinutes });

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}" role="img" aria-label="${escapedTitle}">`,
    `  <title>${escapedTitle}</title>`,
    `  <image x="0" y="0" width="${widthPx}" height="${heightPx}" href="${escapedBoundaryDataUrl}" />`,
    '  <g id="isochrone-edges">',
    edgeLines,
    '  </g>',
    '</svg>',
  ].join('\n');
}

export function buildSvgExportFilename(now = new Date()) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error('now must be a valid Date');
  }

  const year = now.getFullYear();
  const month = pad2(now.getMonth() + 1);
  const day = pad2(now.getDate());
  const hours = pad2(now.getHours());
  const minutes = pad2(now.getMinutes());
  const seconds = pad2(now.getSeconds());
  return `isochrone-${year}${month}${day}-${hours}${minutes}${seconds}.svg`;
}

export function exportCurrentRenderedIsochroneSvg(shell, options = {}) {
  if (!shell || typeof shell !== 'object') {
    throw new Error('shell is required');
  }
  if (!shell.boundaryCanvas || typeof shell.boundaryCanvas.toDataURL !== 'function') {
    throw new Error('shell.boundaryCanvas with toDataURL is required');
  }
  if (!shell.isochroneCanvas || !Number.isInteger(shell.isochroneCanvas.width)) {
    throw new Error('shell.isochroneCanvas with width/height is required');
  }

  const widthPx = shell.isochroneCanvas.width;
  const heightPx = shell.isochroneCanvas.height;
  assertPositiveInteger(widthPx, 'shell.isochroneCanvas.width');
  assertPositiveInteger(heightPx, 'shell.isochroneCanvas.height');

  const boundaryLayerDataUrl = shell.boundaryCanvas.toDataURL('image/png');
  const svgDocument = buildRenderedIsochroneSvgDocument({
    widthPx,
    heightPx,
    boundaryLayerDataUrl,
    edgeVertexData: options.edgeVertexData ?? new Float32Array(0),
    cycleMinutes: options.cycleMinutes ?? DEFAULT_COLOUR_CYCLE_MINUTES,
    title: options.title ?? 'Isochrone export',
  });
  const filename = options.filename ?? buildSvgExportFilename(options.now ?? new Date());

  const documentObject = options.documentObject ?? globalThis.document;
  const urlObject = options.urlObject ?? globalThis.URL;
  const scheduleRevoke = options.scheduleRevoke ?? ((callback) => setTimeout(callback, 0));
  if (!documentObject || typeof documentObject.createElement !== 'function' || !documentObject.body) {
    throw new Error('A DOM document with body is required for SVG download');
  }
  if (!urlObject || typeof urlObject.createObjectURL !== 'function' || typeof urlObject.revokeObjectURL !== 'function') {
    throw new Error('URL.createObjectURL/revokeObjectURL are required for SVG download');
  }
  if (typeof scheduleRevoke !== 'function') {
    throw new Error('options.scheduleRevoke must be a function when provided');
  }

  const blob = new Blob([svgDocument], { type: 'image/svg+xml;charset=utf-8' });
  const objectUrl = urlObject.createObjectURL(blob);
  const anchor = documentObject.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  documentObject.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  scheduleRevoke(() => {
    urlObject.revokeObjectURL(objectUrl);
  });

  return { filename, svgDocument };
}

export function bindSvgExportControl(shell, dependencies = {}) {
  if (!shell || typeof shell !== 'object' || !shell.exportSvgButton) {
    throw new Error('shell.exportSvgButton is required');
  }

  const exportSvg = dependencies.exportCurrentRenderedIsochroneSvg;
  if (typeof exportSvg !== 'function') {
    throw new Error('dependencies.exportCurrentRenderedIsochroneSvg must be a function');
  }
  const onExportSuccess = dependencies.onExportSuccess;
  if (onExportSuccess !== undefined && typeof onExportSuccess !== 'function') {
    throw new Error('dependencies.onExportSuccess must be a function when provided');
  }
  const onExportError = dependencies.onExportError;
  if (onExportError !== undefined && typeof onExportError !== 'function') {
    throw new Error('dependencies.onExportError must be a function when provided');
  }

  const handleClick = () => {
    let exportResult;
    try {
      exportResult = exportSvg(shell);
    } catch (error) {
      if (typeof onExportError === 'function') {
        onExportError(error);
      }
      return;
    }

    Promise.resolve(exportResult)
      .then((resolvedResult) => {
        if (typeof onExportSuccess === 'function') {
          onExportSuccess(resolvedResult);
        }
      })
      .catch((error) => {
        if (typeof onExportError === 'function') {
          onExportError(error);
        }
      });
  };

  shell.exportSvgButton.addEventListener('click', handleClick);
  return {
    dispose() {
      shell.exportSvgButton.removeEventListener('click', handleClick);
    },
  };
}
