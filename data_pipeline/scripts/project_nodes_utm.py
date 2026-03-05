#!/usr/bin/env python3
"""Project extracted walkable node coordinates into UTM offsets and grid metrics."""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

from isochrone_pipeline.osm_graph_extract import extract_walkable_graph_input
from isochrone_pipeline.projection import project_nodes_to_utm


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input",
        type=Path,
        default=Path("data_pipeline/input/berlin-routing.osm.json"),
        help="Path to Overpass JSON input.",
    )
    parser.add_argument(
        "--epsg",
        type=int,
        default=25833,
        help="Target EPSG code (default 25833 for Berlin).",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data_pipeline/output/projected-node-summary.json"),
        help="Path to projection summary JSON output.",
    )
    args = parser.parse_args()

    extracted = extract_walkable_graph_input(args.input)
    projected = project_nodes_to_utm(extracted.node_coords, epsg_code=args.epsg)

    summary = {
        "generated_at_utc": datetime.now(UTC).isoformat(),
        "input": str(args.input),
        "epsg_code": projected.epsg_code,
        "pixel_size_m": projected.pixel_size_m,
        "origin_easting": projected.origin_easting,
        "origin_northing": projected.origin_northing,
        "max_easting": projected.max_easting,
        "max_northing": projected.max_northing,
        "grid_width_px": projected.grid_width_px,
        "grid_height_px": projected.grid_height_px,
        "node_count": len(projected.node_offsets_m),
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print(f"Wrote {args.output}")
    print(f"node_count={summary['node_count']}")
    print(f"grid_width_px={summary['grid_width_px']}")
    print(f"grid_height_px={summary['grid_height_px']}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
