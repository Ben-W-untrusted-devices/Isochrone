#!/usr/bin/env python3
"""Compute a walking route with A* between two OSM node IDs."""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

from isochrone_pipeline.adjacency import build_adjacency_graph
from isochrone_pipeline.osm_graph_extract import extract_walkable_graph_input
from isochrone_pipeline.projection import project_nodes_to_utm
from isochrone_pipeline.routing import astar_route_by_osm_ids
from isochrone_pipeline.simplify import simplify_degree2_chains


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input",
        type=Path,
        default=Path("data_pipeline/input/berlin-routing.osm.json"),
        help="Path to Overpass JSON input.",
    )
    parser.add_argument(
        "--start-node-id",
        type=int,
        required=True,
        help="OSM node ID for route start.",
    )
    parser.add_argument(
        "--finish-node-id",
        type=int,
        required=True,
        help="OSM node ID for route destination.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data_pipeline/output/astar-route.json"),
        help="Path to route JSON output.",
    )
    args = parser.parse_args()

    extracted = extract_walkable_graph_input(args.input)
    projected = project_nodes_to_utm(extracted.node_coords)
    graph = build_adjacency_graph(extracted, projected)
    simplified = simplify_degree2_chains(graph)

    route = astar_route_by_osm_ids(
        simplified.graph,
        start_osm_id=args.start_node_id,
        goal_osm_id=args.finish_node_id,
    )

    result = {
        "generated_at_utc": datetime.now(UTC).isoformat(),
        "input": str(args.input),
        "start_node_id": route.start_osm_id,
        "finish_node_id": route.goal_osm_id,
        "total_cost_seconds": route.total_cost_seconds,
        "expanded_node_count": route.expanded_node_count,
        "heuristic_cost_per_meter": route.heuristic_cost_per_meter,
        "path_node_count": len(route.path_node_indices),
        "path_node_indices": list(route.path_node_indices),
        "path_node_osm_ids": list(route.path_node_osm_ids),
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")

    minutes = route.total_cost_seconds / 60.0
    print(f"Wrote {args.output}")
    print(f"total_cost_seconds={route.total_cost_seconds}")
    print(f"total_cost_minutes={minutes:.2f}")
    print(f"path_node_count={len(route.path_node_indices)}")
    print(f"expanded_node_count={route.expanded_node_count}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
