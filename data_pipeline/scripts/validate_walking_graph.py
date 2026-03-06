#!/usr/bin/env python3
"""Validate simplified walking graph integrity and landmark reachability."""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

from isochrone_pipeline.adjacency import build_adjacency_graph
from isochrone_pipeline.osm_graph_extract import extract_walkable_graph_input
from isochrone_pipeline.projection import project_nodes_to_utm
from isochrone_pipeline.simplify import simplify_degree2_chains
from isochrone_pipeline.validation import (
    BERLIN_VALIDATION_LOCATIONS,
    match_locations_to_nearest_nodes,
    validate_graph_integrity,
    validate_landmark_reachability,
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
        default=Path("data_pipeline/output/graph-validation-summary.json"),
        help="Path to graph validation summary JSON output.",
    )
    args = parser.parse_args()

    extracted = extract_walkable_graph_input(args.input)
    projected = project_nodes_to_utm(extracted.node_coords)
    graph = build_adjacency_graph(extracted, projected)
    simplified = simplify_degree2_chains(graph)

    integrity = validate_graph_integrity(simplified.graph)
    matches = match_locations_to_nearest_nodes(
        simplified.graph,
        locations=BERLIN_VALIDATION_LOCATIONS,
        origin_easting=projected.origin_easting,
        origin_northing=projected.origin_northing,
        epsg_code=projected.epsg_code,
    )
    reachability = validate_landmark_reachability(simplified.graph, matches)

    if not reachability.all_reachable:
        raise ValueError(
            "validation failed: selected Berlin landmarks are not mutually reachable; "
            f"details={reachability.source_to_unreachable}"
        )

    summary = {
        "generated_at_utc": datetime.now(UTC).isoformat(),
        "input": str(args.input),
        "before_node_count": simplified.before_node_count,
        "before_edge_count": simplified.before_edge_count,
        "after_node_count": simplified.after_node_count,
        "after_edge_count": simplified.after_edge_count,
        "integrity": {
            "edge_count": integrity.edge_count,
            "out_of_range_edge_count": integrity.out_of_range_edge_count,
            "non_positive_cost_count": integrity.non_positive_cost_count,
        },
        "landmarks": [
            {
                "name": match.name,
                "node_index": match.node_index,
                "node_osm_id": match.node_osm_id,
                "distance_m": round(match.distance_m, 2),
            }
            for match in matches
        ],
        "all_landmarks_reachable": reachability.all_reachable,
        "source_to_unreachable": {
            name: list(unreachable)
            for name, unreachable in reachability.source_to_unreachable.items()
        },
        "source_to_reachable_count": reachability.source_to_reachable_count,
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print(f"Wrote {args.output}")
    print(f"after_node_count={summary['after_node_count']}")
    print(f"after_edge_count={summary['after_edge_count']}")
    print(f"all_landmarks_reachable={summary['all_landmarks_reachable']}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
