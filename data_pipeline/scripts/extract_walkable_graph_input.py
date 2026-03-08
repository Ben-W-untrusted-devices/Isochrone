#!/usr/bin/env python3
"""Extract walkable-way candidates and referenced nodes from Overpass JSON."""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

from isochrone_pipeline.osm_graph_extract import (
    extract_walkable_graph_input,
    summarize_constraint_tag_coverage,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input",
        type=Path,
        default=Path("data_pipeline/input/berlin-routing.osm.json"),
        help="Path to Overpass JSON input.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data_pipeline/output/walkable-extract-summary.json"),
        help="Path to summary JSON output.",
    )
    args = parser.parse_args()

    extracted = extract_walkable_graph_input(args.input)
    tag_coverage = summarize_constraint_tag_coverage(extracted.ways)

    summary = {
        "generated_at_utc": datetime.now(UTC).isoformat(),
        "input": str(args.input),
        "way_count": len(extracted.ways),
        "node_count": len(extracted.node_coords),
        "connector_count": len(extracted.connector_nodes),
        "dropped_way_count": extracted.dropped_way_count,
        "constraint_tag_presence": tag_coverage.tag_presence,
        "constraint_tag_coverage_ratio": tag_coverage.tag_coverage_ratio,
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print(f"Wrote {args.output}")
    print(f"way_count={summary['way_count']}")
    print(f"node_count={summary['node_count']}")
    print(f"connector_count={summary['connector_count']}")
    print(f"dropped_way_count={summary['dropped_way_count']}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
