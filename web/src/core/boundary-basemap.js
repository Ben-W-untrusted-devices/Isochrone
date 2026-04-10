import { validateGraphHeaderForBoundaryAlignment } from './graph-validation.js';
import { normalizeIsochroneTheme } from '../render/colour.js';

export function parseBoundaryBasemapPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('boundary payload must be an object');
  }

  const coordinateSpace = payload.coordinate_space;
  if (!coordinateSpace || typeof coordinateSpace !== 'object') {
    throw new Error('boundary payload is missing coordinate_space');
  }

  const width = asFiniteNumber(coordinateSpace.width, 'coordinate_space.width');
  const height = asFiniteNumber(coordinateSpace.height, 'coordinate_space.height');
  const xOrigin = asFiniteNumber(coordinateSpace.x_origin, 'coordinate_space.x_origin');
  const yOrigin = asFiniteNumber(coordinateSpace.y_origin, 'coordinate_space.y_origin');
  const axis =
    typeof coordinateSpace.axis === 'string' ? coordinateSpace.axis : 'x-right-y-down';

  if (width <= 0 || height <= 0) {
    throw new Error('coordinate_space width/height must be positive');
  }
  if (axis !== 'x-right-y-down') {
    throw new Error(`unsupported boundary coordinate_space.axis: ${axis}`);
  }

  const rawFeatures = payload.features;
  if (!Array.isArray(rawFeatures)) {
    throw new Error('boundary payload is missing features[]');
  }

  const features = rawFeatures
    .map((feature, featureIndex) => {
      if (!feature || typeof feature !== 'object') {
        throw new Error(`features[${featureIndex}] must be an object`);
      }

      const name = typeof feature.name === 'string' ? feature.name : `feature_${featureIndex}`;
      const relationId = Number.isFinite(feature.relation_id) ? feature.relation_id : null;

      if (!Array.isArray(feature.paths)) {
        throw new Error(`features[${featureIndex}].paths must be an array`);
      }

      const paths = feature.paths
        .map((path, pathIndex) => {
          if (!Array.isArray(path)) {
            throw new Error(`features[${featureIndex}].paths[${pathIndex}] must be an array`);
          }

          return path
            .map((point, pointIndex) =>
              parseCoordinatePair(
                point,
                `features[${featureIndex}].paths[${pathIndex}][${pointIndex}]`,
              ),
            )
            .filter((point) => point.length === 2);
        })
        .filter((path) => path.length >= 2);

      return {
        name,
        relationId,
        paths,
      };
    })
    .filter((feature) => feature.paths.length > 0);

  if (features.length === 0) {
    throw new Error('boundary payload has no drawable paths');
  }

  return {
    coordinateSpace: {
      xOrigin,
      yOrigin,
      width,
      height,
      axis,
    },
    features,
  };
}

export function projectBoundaryBasemapToGraphPaths(payloadOrParsedBoundary, graphHeader) {
  validateGraphHeaderForBoundaryAlignment(graphHeader);
  const parsedBoundary = isParsedBoundaryBasemapPayload(payloadOrParsedBoundary)
    ? payloadOrParsedBoundary
    : parseBoundaryBasemapPayload(payloadOrParsedBoundary);

  const maxY = graphHeader.gridHeightPx - 1;
  return {
    coordinateSpace: parsedBoundary.coordinateSpace,
    features: parsedBoundary.features.map((feature) => ({
      name: feature.name,
      relationId: feature.relationId,
      paths: feature.paths.map((path) =>
        path.map((point) => {
          const easting = parsedBoundary.coordinateSpace.xOrigin + point[0];
          const northing = parsedBoundary.coordinateSpace.yOrigin - point[1];
          const xPx = (easting - graphHeader.originEasting) / graphHeader.pixelSizeM;
          const yPx = maxY - (northing - graphHeader.originNorthing) / graphHeader.pixelSizeM;
          return [xPx, yPx];
        }),
      ),
    })),
  };
}

export function isClosedPath(path) {
  if (!Array.isArray(path) || path.length < 2) {
    return false;
  }
  const [firstX, firstY] = path[0];
  const [lastX, lastY] = path[path.length - 1];
  return firstX === lastX && firstY === lastY;
}

export function getBoundaryStrokeStyle(colourTheme) {
  return normalizeIsochroneTheme(colourTheme, 'dark') === 'light'
    ? 'rgba(58, 94, 126, 0.62)'
    : 'rgba(125, 175, 220, 0.55)';
}

function isParsedBoundaryBasemapPayload(value) {
  return (
    value
    && typeof value === 'object'
    && value.coordinateSpace
    && typeof value.coordinateSpace === 'object'
    && Array.isArray(value.features)
  );
}

function parseCoordinatePair(value, context) {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error(`${context} must be a [x, y] coordinate pair`);
  }

  return [asFiniteNumber(value[0], `${context}[0]`), asFiniteNumber(value[1], `${context}[1]`)];
}

function asFiniteNumber(value, context) {
  if (!Number.isFinite(value)) {
    throw new Error(`${context} must be a finite number`);
  }
  return value;
}
