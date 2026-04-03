# Region Data Pipeline

This document describes the full pipeline for turning a place in OpenStreetMap into web-loadable assets for this app.

It is intentionally explicit because `data_pipeline/fetch-data.sh` is only the first stage. Running it does not create `.bin.gz` graph artifacts or canvas-ready boundary JSON by itself.

## What Exists Today

Implemented:
- Raw Overpass download for routing and subdivision-boundary JSON via `data_pipeline/fetch-data.sh`
- Boundary simplification to canvas JSON via `data_pipeline/scripts/simplify_boundary_json.py`
- Routing graph extraction and binary export via `data_pipeline/scripts/export_graph_binary.py`
- Browser loading of per-location asset filenames from `web/src/data/locations.json`

Still manual:
- Choosing the correct projection (`--epsg`) per region
- Running the transform/export commands per region
- Gzipping each binary graph
- Adding the new region to `web/src/data/locations.json`
- Publishing the new artifacts in `.github/workflows/pages.yml`

## Stage 1: Fetch Raw OSM JSON

Run:

```bash
./data_pipeline/fetch-data.sh
```

Outputs go to `data_pipeline/input/` and are named:
- `<slug>-routing.osm.json`
- `<slug>-district-boundaries.osm.json`

Examples:
- `data_pipeline/input/paris-routing.osm.json`
- `data_pipeline/input/paris-district-boundaries.osm.json`

This stage only downloads raw Overpass API responses.

## Stage 2: Simplify Boundaries For Canvas Rendering

For each fetched region, convert the subdivision-boundary extract into the simplified JSON consumed by the browser basemap renderer.

Command shape:

```bash
.venv/bin/python data_pipeline/scripts/simplify_boundary_json.py \
  --input data_pipeline/input/<slug>-district-boundaries.osm.json \
  --output data_pipeline/output/<slug>-district-boundaries-canvas.json \
  --resolution 25 \
  --units meters \
  --epsg <projected-epsg> \
  --admin-level <same admin_level used by the boundary query>
```

Notes:
- `--epsg` must be a projected CRS suitable for the region. This is not inferred automatically today.
- `--admin-level` should match the subdivision level passed to the boundary query generator for that place.
- The output file is what the web app loads as the basemap for that region.

## Stage 3: Export Routing Graph Binary

For each fetched region, convert the routing extract into the compact binary graph used by the browser.

For new regions, use region-specific output filenames. Berlin currently still uses the legacy names `graph-walk.bin` and `graph-walk.bin.gz`.

Command shape:

```bash
.venv/bin/python data_pipeline/scripts/export_graph_binary.py \
  --input data_pipeline/input/<slug>-routing.osm.json \
  --binary-output data_pipeline/output/<slug>-graph.bin \
  --summary-output data_pipeline/output/<slug>-graph-summary.json \
  --epsg <projected-epsg>
```

Notes:
- `--epsg` must match the projected coordinate system you want for that region.
- The `.json` summary is inspection/debug output; the browser does not load it directly.

## Stage 4: Gzip The Graph For Web Delivery

The browser currently loads gzip-compressed graph binaries.

Command:

```bash
gzip -c data_pipeline/output/<slug>-graph.bin > data_pipeline/output/<slug>-graph.bin.gz
```

Example:

```bash
gzip -c data_pipeline/output/paris-graph.bin > data_pipeline/output/paris-graph.bin.gz
```

If this step has not been run, you will not see a new gzipped graph artifact for that region.

## Stage 5: Register The Region In The UI

Add an entry to `web/src/data/locations.json`:

```json
{
  "id": "paris",
  "name": "Paris",
  "graphFileName": "paris-graph.bin.gz",
  "boundaryFileName": "paris-district-boundaries-canvas.json"
}
```

The top-bar location menu reads this file and loads the matching graph and boundary assets.

## Stage 6: Publish The New Assets

If the region should be available on GitHub Pages, update `.github/workflows/pages.yml` so it copies the new files into the site artifact.

Current workflow only publishes Berlin:
- `data_pipeline/output/berlin-district-boundaries-canvas.json`
- `data_pipeline/output/graph-walk.bin.gz`

For a new region such as Paris, add copies for:
- `data_pipeline/output/paris-district-boundaries-canvas.json`
- `data_pipeline/output/paris-graph.bin.gz`

## Paris Example

Assuming `fetch-data.sh` has produced:
- `data_pipeline/input/paris-routing.osm.json`
- `data_pipeline/input/paris-district-boundaries.osm.json`

The remaining manual steps are:

```bash
.venv/bin/python data_pipeline/scripts/simplify_boundary_json.py \
  --input data_pipeline/input/paris-district-boundaries.osm.json \
  --output data_pipeline/output/paris-district-boundaries-canvas.json \
  --resolution 25 \
  --units meters \
  --epsg <paris-projected-epsg> \
  --admin-level 9

.venv/bin/python data_pipeline/scripts/export_graph_binary.py \
  --input data_pipeline/input/paris-routing.osm.json \
  --binary-output data_pipeline/output/paris-graph.bin \
  --summary-output data_pipeline/output/paris-graph-summary.json \
  --epsg <paris-projected-epsg>

gzip -c data_pipeline/output/paris-graph.bin > data_pipeline/output/paris-graph.bin.gz
```

Then:
- add Paris to `web/src/data/locations.json`
- update `.github/workflows/pages.yml` if Paris should be deployed

## Full Process Checklist

1. Fetch raw Overpass JSON with `./data_pipeline/fetch-data.sh`
2. Simplify boundaries into `<slug>-district-boundaries-canvas.json`
3. Export routing graph into `<slug>-graph.bin`
4. Gzip graph into `<slug>-graph.bin.gz`
5. Add the region entry to `web/src/data/locations.json`
6. Update GitHub Pages workflow if the region should ship in the deployed site

That is the full process as the repository currently stands.
