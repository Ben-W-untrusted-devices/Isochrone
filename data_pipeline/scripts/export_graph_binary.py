#!/usr/bin/env python3
"""Export simplified walking graph to MVP binary format."""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

from isochrone_pipeline.adjacency import (
    MODE_MASK_BIKE,
    MODE_MASK_CAR,
    MODE_MASK_WALK,
    GraphEdge,
    build_adjacency_graph,
)
from isochrone_pipeline.binary_reader import parse_header
from isochrone_pipeline.graph_binary import export_graph_binary_bytes
from isochrone_pipeline.osm_graph_extract import (
    extract_walkable_graph_input,
    summarize_constraint_tag_coverage,
)
from isochrone_pipeline.projection import project_nodes_to_utm
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
        "--binary-output",
        type=Path,
        default=Path("data_pipeline/output/graph-walk.bin"),
        help="Path to binary graph output.",
    )
    parser.add_argument(
        "--summary-output",
        type=Path,
        default=Path("data_pipeline/output/graph-binary-summary.json"),
        help="Path to binary export summary JSON output.",
    )
    parser.add_argument(
        "--epsg",
        type=int,
        default=25833,
        help="Target EPSG code (default 25833 for Berlin).",
    )
    args = parser.parse_args()

    extracted = extract_walkable_graph_input(args.input)
    tag_coverage = summarize_constraint_tag_coverage(extracted.ways)
    projected = project_nodes_to_utm(extracted.node_coords, epsg_code=args.epsg)
    graph = build_adjacency_graph(extracted, projected)
    simplified = simplify_degree2_chains(graph)

    payload = export_graph_binary_bytes(simplified.graph, projection=projected)

    args.binary_output.parent.mkdir(parents=True, exist_ok=True)
    args.binary_output.write_bytes(payload)

    header = parse_header(payload)
    summary = {
        "generated_at_utc": datetime.now(UTC).isoformat(),
        "input": str(args.input),
        "binary_output": str(args.binary_output),
        "binary_size_bytes": len(payload),
        "before_node_count": simplified.before_node_count,
        "before_edge_count": simplified.before_edge_count,
        "after_node_count": simplified.after_node_count,
        "after_edge_count": simplified.after_edge_count,
        "constraint_tag_presence": tag_coverage.tag_presence,
        "constraint_tag_coverage_ratio": tag_coverage.tag_coverage_ratio,
        "edge_mode_mask_counts": _edge_mode_mask_counts(simplified.graph.edges),
        "edge_mode_counts": _edge_mode_counts(simplified.graph.edges),
        "edge_mode_coverage_ratio": _edge_mode_coverage_ratio(simplified.graph.edges),
        "header": {
            "magic": f"0x{header.magic:08X}",
            "version": header.version,
            "flags": header.flags,
            "n_nodes": header.n_nodes,
            "n_edges": header.n_edges,
            "n_stops": header.n_stops,
            "n_tedges": header.n_tedges,
            "origin_easting": header.origin_easting,
            "origin_northing": header.origin_northing,
            "epsg_code": header.epsg_code,
            "grid_width_px": header.grid_width_px,
            "grid_height_px": header.grid_height_px,
            "pixel_size_m": header.pixel_size_m,
            "node_table_offset": header.node_table_offset,
            "edge_table_offset": header.edge_table_offset,
            "stop_table_offset": header.stop_table_offset,
        },
    }

    args.summary_output.parent.mkdir(parents=True, exist_ok=True)
    args.summary_output.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print(f"Wrote {args.binary_output}")
    print(f"Wrote {args.summary_output}")
    print(f"binary_size_bytes={len(payload)}")
    print(f"after_node_count={simplified.after_node_count}")
    print(f"after_edge_count={simplified.after_edge_count}")

    return 0


def _edge_mode_mask_counts(edges: tuple[GraphEdge, ...]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for edge in edges:
        key = str(edge.mode_mask)
        counts[key] = counts.get(key, 0) + 1
    return counts


def _edge_mode_counts(edges: tuple[GraphEdge, ...]) -> dict[str, int]:
    counts = {"walk": 0, "bike": 0, "car": 0}
    for edge in edges:
        if edge.mode_mask & MODE_MASK_WALK:
            counts["walk"] += 1
        if edge.mode_mask & MODE_MASK_BIKE:
            counts["bike"] += 1
        if edge.mode_mask & MODE_MASK_CAR:
            counts["car"] += 1
    return counts


def _edge_mode_coverage_ratio(edges: tuple[GraphEdge, ...]) -> dict[str, float]:
    total_edges = len(edges)
    if total_edges == 0:
        return {"walk": 0.0, "bike": 0.0, "car": 0.0}

    mode_counts = _edge_mode_counts(edges)
    return {
        "walk": mode_counts["walk"] / total_edges,
        "bike": mode_counts["bike"] / total_edges,
        "car": mode_counts["car"] / total_edges,
    }


if __name__ == "__main__":
    raise SystemExit(main())
