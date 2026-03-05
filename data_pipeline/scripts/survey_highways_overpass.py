#!/usr/bin/env python3
"""Survey Berlin routing-relevant OSM tags via targeted Overpass queries."""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import requests
from isochrone_pipeline.overpass_survey import compute_node_density_per_km

OVERPASS_ENDPOINTS: tuple[str, ...] = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
)

ROUTING_TAGS: tuple[str, ...] = (
    "maxspeed",
    "maxspeed:forward",
    "maxspeed:backward",
    "access",
    "foot",
    "vehicle",
    "motor_vehicle",
    "bicycle",
    "oneway",
    "oneway:foot",
    "sidewalk",
)


def _run_overpass_query(query: str, timeout_s: int) -> list[dict[str, Any]]:
    payload = {"data": query}
    last_error: Exception | None = None

    for endpoint in OVERPASS_ENDPOINTS:
        try:
            response = requests.post(endpoint, data=payload, timeout=timeout_s)
            response.raise_for_status()
            body = response.json()
            elements = body.get("elements")
            if isinstance(elements, list):
                return elements
            raise RuntimeError(f"Unexpected Overpass response shape from {endpoint}")
        except Exception as error:  # noqa: BLE001
            last_error = error

    assert last_error is not None
    raise RuntimeError("All Overpass endpoints failed") from last_error


def _build_tag_query() -> str:
    return """
[out:json][timeout:300];
rel(62422)->.berlinRel;
.berlinRel map_to_area->.searchArea;
(
  way["highway"](area.searchArea);
  relation["highway"](area.searchArea);
  node["barrier"](area.searchArea);
  node["highway"="crossing"](area.searchArea);
  node["railway"="level_crossing"](area.searchArea);
  node["entrance"](area.searchArea);
);
out tags;
""".strip()


def _build_highway_geometry_query(limit: int) -> str:
    return f"""
[out:json][timeout:300];
rel(62422)->.berlinRel;
.berlinRel map_to_area->.searchArea;
way["highway"](area.searchArea);
out geom qt {limit};
""".strip()


def _count_highway_values(elements: list[dict[str, Any]]) -> Counter[str]:
    counts: Counter[str] = Counter()

    for element in elements:
        if element.get("type") not in {"way", "relation"}:
            continue

        tags = element.get("tags")
        if not isinstance(tags, dict):
            continue

        highway = tags.get("highway")
        if isinstance(highway, str):
            counts[highway] += 1

    return counts


def _count_connector_nodes(elements: list[dict[str, Any]]) -> Counter[str]:
    counts: Counter[str] = Counter()

    for element in elements:
        if element.get("type") != "node":
            continue

        tags = element.get("tags")
        if not isinstance(tags, dict):
            continue

        if "barrier" in tags:
            counts["barrier=*"] += 1
        if tags.get("highway") == "crossing":
            counts["highway=crossing"] += 1
        if tags.get("railway") == "level_crossing":
            counts["railway=level_crossing"] += 1
        if "entrance" in tags:
            counts["entrance=*"] += 1

    return counts


def _count_routing_tag_presence(elements: list[dict[str, Any]]) -> Counter[str]:
    counts: Counter[str] = Counter()

    for element in elements:
        if element.get("type") not in {"way", "relation"}:
            continue

        tags = element.get("tags")
        if not isinstance(tags, dict):
            continue

        if "highway" not in tags:
            continue

        for tag in ROUTING_TAGS:
            if tag in tags:
                counts[tag] += 1

    return counts


def _write_report(
    report_path: Path,
    highway_counts: Counter[str],
    connector_counts: Counter[str],
    routing_tag_presence: Counter[str],
    density_nodes_per_km: float | None,
    sample_size: int,
) -> None:
    lines: list[str] = []
    lines.append("# Berlin Routing Tag Survey (Overpass)")
    lines.append("")
    lines.append(f"Generated: {datetime.now(UTC).isoformat()}")
    lines.append("")
    lines.append("## Method")
    lines.append("- Query 1: all Berlin highway ways/relations + connector nodes (`out tags`).")
    lines.append(
        "- Query 2: highway way geometry sample "
        f"({sample_size} ways) for node-density-per-km estimation."
    )
    lines.append("- Public polygons are intentionally excluded.")
    lines.append("")

    lines.append("## `highway=*` counts (top 25)")
    lines.append("")
    lines.append("| highway | elements |")
    lines.append("|---|---:|")
    for highway, count in highway_counts.most_common(25):
        lines.append(f"| `{highway}` | {count:,} |")
    lines.append("")

    lines.append("## Connector node counts")
    lines.append("")
    lines.append("| connector | count |")
    lines.append("|---|---:|")
    for name in ("barrier=*", "highway=crossing", "railway=level_crossing", "entrance=*"):
        lines.append(f"| `{name}` | {connector_counts.get(name, 0):,} |")
    lines.append("")

    lines.append("## Routing-tag presence on highway elements")
    lines.append("")
    lines.append("| tag | elements with tag |")
    lines.append("|---|---:|")
    for tag in ROUTING_TAGS:
        lines.append(f"| `{tag}` | {routing_tag_presence.get(tag, 0):,} |")
    lines.append("")

    lines.append("## Typical node density per km of way")
    lines.append("")
    if density_nodes_per_km is None:
        lines.append("- Could not compute (insufficient geometry length).")
    else:
        lines.append(f"- Estimated `~{density_nodes_per_km:.2f}` nodes/km from sampled ways.")

    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--sample-limit",
        type=int,
        default=2000,
        help="Max number of highway ways to fetch geometry for density estimate.",
    )
    parser.add_argument(
        "--output-markdown",
        type=Path,
        default=Path("docs/osm-highway-survey.md"),
        help="Path to output markdown report.",
    )
    parser.add_argument(
        "--output-json",
        type=Path,
        default=Path("data_pipeline/output/osm-highway-survey.json"),
        help="Path to output machine-readable summary.",
    )
    args = parser.parse_args()

    if args.sample_limit <= 0:
        raise ValueError("--sample-limit must be positive")

    tag_elements = _run_overpass_query(_build_tag_query(), timeout_s=360)
    highway_counts = _count_highway_values(tag_elements)
    connector_counts = _count_connector_nodes(tag_elements)
    routing_tag_presence = _count_routing_tag_presence(tag_elements)

    geometry_elements = _run_overpass_query(
        _build_highway_geometry_query(args.sample_limit), timeout_s=360
    )
    highway_way_elements = [
        element
        for element in geometry_elements
        if element.get("type") == "way" and isinstance(element.get("geometry"), list)
    ]
    density_nodes_per_km = compute_node_density_per_km(highway_way_elements)

    _write_report(
        report_path=args.output_markdown,
        highway_counts=highway_counts,
        connector_counts=connector_counts,
        routing_tag_presence=routing_tag_presence,
        density_nodes_per_km=density_nodes_per_km,
        sample_size=len(highway_way_elements),
    )

    payload = {
        "generated_at_utc": datetime.now(UTC).isoformat(),
        "sample_way_count": len(highway_way_elements),
        "density_nodes_per_km": density_nodes_per_km,
        "top_highway_counts": highway_counts.most_common(50),
        "connector_counts": dict(connector_counts),
        "routing_tag_presence": {tag: routing_tag_presence.get(tag, 0) for tag in ROUTING_TAGS},
    }
    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_json.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    print(f"Wrote markdown report: {args.output_markdown}")
    print(f"Wrote JSON summary: {args.output_json}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(f"ERROR: {error}", file=sys.stderr)
        raise
