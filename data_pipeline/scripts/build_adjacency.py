#!/usr/bin/env python3
"""Build walkable adjacency list summary from Overpass JSON input."""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

from isochrone_pipeline.adjacency import build_adjacency_graph
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
        "--output",
        type=Path,
        default=Path("data_pipeline/output/adjacency-summary.json"),
        help="Path to adjacency summary JSON output.",
    )
    args = parser.parse_args()

    extracted = extract_walkable_graph_input(args.input)
    projected = project_nodes_to_utm(extracted.node_coords)
    graph = build_adjacency_graph(extracted, projected)

    summary = {
        "generated_at_utc": datetime.now(UTC).isoformat(),
        "input": str(args.input),
        "node_count": len(graph.nodes),
        "edge_count": len(graph.edges),
        "skipped_constraint_way_count": graph.skipped_constraint_way_count,
        "dropped_missing_node_way_count": extracted.dropped_way_count,
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print(f"Wrote {args.output}")
    print(f"node_count={summary['node_count']}")
    print(f"edge_count={summary['edge_count']}")
    print(f"skipped_constraint_way_count={summary['skipped_constraint_way_count']}")
    print(f"dropped_missing_node_way_count={summary['dropped_missing_node_way_count']}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
