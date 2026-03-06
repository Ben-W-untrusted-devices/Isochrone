#!/usr/bin/env python3
"""Simplify Overpass district-boundary JSON and emit canvas-ready geometry."""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

from isochrone_pipeline.boundary_canvas import simplify_overpass_boundaries_for_canvas


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input",
        type=Path,
        required=True,
        help="Path to Overpass JSON input (from berlin_district_boundaries_query.ql).",
    )
    parser.add_argument(
        "--output",
        type=Path,
        required=True,
        help="Path to simplified canvas-ready JSON output.",
    )
    parser.add_argument(
        "--resolution",
        type=float,
        required=True,
        help="Simplification tolerance value.",
    )
    parser.add_argument(
        "--units",
        choices=("meters", "degrees"),
        required=True,
        help="Units for --resolution.",
    )
    parser.add_argument(
        "--epsg",
        type=int,
        default=25833,
        help="Projection used when --units=meters (default: 25833).",
    )
    parser.add_argument(
        "--admin-level",
        default="9",
        help="Administrative level filter (default: 9 for Berlin districts).",
    )
    args = parser.parse_args()

    overpass_json = json.loads(args.input.read_text(encoding="utf-8"))
    payload = simplify_overpass_boundaries_for_canvas(
        overpass_json,
        tolerance=args.resolution,
        units=args.units,
        epsg_code=args.epsg,
        admin_level=args.admin_level,
    )

    output = {
        "generated_at_utc": datetime.now(UTC).isoformat(),
        "input": str(args.input),
        **payload,
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2), encoding="utf-8")

    print(f"Wrote {args.output}")
    print(f"feature_count={output['stats']['feature_count']}")
    print(f"path_count={output['stats']['path_count']}")
    print(f"input_point_count={output['stats']['input_point_count']}")
    print(f"output_point_count={output['stats']['output_point_count']}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
