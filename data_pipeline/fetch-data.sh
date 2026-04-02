#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

OVERPASS_URL="${OVERPASS_URL:-https://overpass-api.de/api/interpreter}"
MAX_TIME_SECONDS="${MAX_TIME_SECONDS:-600}"
INPUT_DIR="${INPUT_DIR:-${REPO_ROOT}/data_pipeline/input}"
ROUTING_QUERY_SCRIPT="${REPO_ROOT}/docs/berlin_overpass_routing_query.ql"
BOUNDARY_QUERY_SCRIPT="${REPO_ROOT}/docs/berlin_district_boundaries_query.ql"

PLACE_SPECS=(
  'berlin|Berlin|rel(62422)["name"="Berlin"]["wikidata"="Q64"]|9'
  'paris|Paris|rel["boundary"="administrative"]["wikidata"="Q90"]|9'
  'london|London|rel["boundary"="administrative"]["wikidata"="Q23306"]|8'
  'rome|Rome|rel["boundary"="administrative"]["wikidata"="Q220"]|10'
  'luxembourg-country|Luxembourg (country)|rel["boundary"="administrative"]["wikidata"="Q32"]|8'
)

if [[ ! -f "${ROUTING_QUERY_SCRIPT}" ]]; then
  echo "Routing query script not found: ${ROUTING_QUERY_SCRIPT}" >&2
  exit 1
fi

if [[ ! -f "${BOUNDARY_QUERY_SCRIPT}" ]]; then
  echo "Boundary query script not found: ${BOUNDARY_QUERY_SCRIPT}" >&2
  exit 1
fi

mkdir -p "${INPUT_DIR}"

fetch_dataset() {
  local query_script="$1"
  local output_file="$2"
  shift 2

  local rendered_query_file
  rendered_query_file="$(mktemp "${TMPDIR:-/tmp}/overpass-query.XXXXXX")"
  {
    zsh "${query_script}" "$@" > "${rendered_query_file}"

    curl --show-error --fail --max-time "${MAX_TIME_SECONDS}" \
      --data-urlencode "data@${rendered_query_file}" \
      "${OVERPASS_URL}" \
      -o "${output_file}"

    echo "Wrote ${output_file}"
  } always {
    rm -f "${rendered_query_file}"
  }
}

for place_spec in "${PLACE_SPECS[@]}"; do
  IFS='|' read -r slug location_label location_relation subdivision_admin_level <<< "${place_spec}"
  routing_output_file="${INPUT_DIR}/${slug}-routing.osm.json"
  boundary_output_file="${INPUT_DIR}/${slug}-district-boundaries.osm.json"

  fetch_dataset \
    "${ROUTING_QUERY_SCRIPT}" \
    "${routing_output_file}" \
    --location-label "${location_label}" \
    --location-relation "${location_relation}"

  fetch_dataset \
    "${BOUNDARY_QUERY_SCRIPT}" \
    "${boundary_output_file}" \
    --location-label "${location_label}" \
    --location-relation "${location_relation}" \
    --subdivision-admin-level "${subdivision_admin_level}"
done
