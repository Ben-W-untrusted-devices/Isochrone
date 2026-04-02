import {
  DEFAULT_LOCATION_FILE_NAME,
  DEFAULT_LOCATION_NAME,
  DEFAULT_LOCATION_REGISTRY_URL,
} from '../config/constants.js';

function normalizeNonEmptyString(value, fieldName) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return value.trim();
}

export function createDefaultLocationRegistry() {
  return {
    locations: [
      {
        name: DEFAULT_LOCATION_NAME,
        fileName: DEFAULT_LOCATION_FILE_NAME,
      },
    ],
  };
}

export function parseLocationRegistry(payload) {
  const locations = payload?.locations;
  if (!Array.isArray(locations) || locations.length === 0) {
    throw new Error('location registry must contain a non-empty locations array');
  }

  const seenFileNames = new Set();
  const normalizedLocations = locations.map((entry, index) => {
    const name = normalizeNonEmptyString(entry?.name, `locations[${index}].name`);
    const fileName = normalizeNonEmptyString(entry?.fileName, `locations[${index}].fileName`);
    if (seenFileNames.has(fileName)) {
      throw new Error(`duplicate location fileName: ${fileName}`);
    }
    seenFileNames.add(fileName);
    return { name, fileName };
  });

  return {
    locations: normalizedLocations,
  };
}

export function findLocationByFileName(registry, fileName) {
  if (!registry || typeof registry !== 'object') {
    return null;
  }
  const normalizedFileName =
    typeof fileName === 'string' && fileName.trim().length > 0
      ? fileName.trim()
      : '';
  if (normalizedFileName.length === 0) {
    return null;
  }
  return registry.locations?.find((entry) => entry.fileName === normalizedFileName) ?? null;
}

export function resolveLocationName(registry, fileName, fallbackName = DEFAULT_LOCATION_NAME) {
  const match = findLocationByFileName(registry, fileName);
  if (match?.name) {
    return match.name;
  }
  return typeof fallbackName === 'string' ? fallbackName.trim() : '';
}

export async function loadLocationRegistry(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch?.bind(globalThis) ?? null;
  const baseUrl = options.baseUrl ?? import.meta.url;
  const registryUrl = options.registryUrl ?? DEFAULT_LOCATION_REGISTRY_URL;
  const fallbackRegistry = createDefaultLocationRegistry();

  if (typeof fetchImpl !== 'function') {
    return fallbackRegistry;
  }

  try {
    const response = await fetchImpl(new URL(registryUrl, baseUrl));
    if (!response?.ok) {
      return fallbackRegistry;
    }
    const parsed = await response.json();
    return parseLocationRegistry(parsed);
  } catch (_error) {
    return fallbackRegistry;
  }
}
