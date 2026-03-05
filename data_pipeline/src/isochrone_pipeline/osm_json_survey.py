"""Survey utilities for Overpass JSON extracts stored on disk."""

from __future__ import annotations

import json
import re
from collections import Counter
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .overpass_survey import WALKABLE_HIGHWAY_VALUES, haversine_m

_ELEMENTS_START_PATTERN = re.compile(r'"elements"\s*:\s*\[')


@dataclass(frozen=True)
class HighwaySurveySummary:
    highway_counts: Counter[str]
    pedestrian_highway_values: tuple[str, ...]
    node_refs_per_km: float | None
    total_highway_way_count: int
    total_way_length_km: float
    missing_segment_count: int


def iter_overpass_elements(path: Path, chunk_size: int = 1 << 16) -> Iterator[dict[str, Any]]:
    """Yield top-level objects from the Overpass `elements` array without full file load."""
    decoder = json.JSONDecoder()

    with path.open("r", encoding="utf-8") as handle:
        buffer = ""
        index = 0

        while True:
            chunk = handle.read(chunk_size)
            if not chunk:
                raise ValueError("No 'elements' array found in input JSON")

            buffer += chunk
            match = _ELEMENTS_START_PATTERN.search(buffer)
            if match:
                index = match.end()
                break

            if len(buffer) > chunk_size * 4:
                buffer = buffer[-(chunk_size * 4) :]

        while True:
            while True:
                while index < len(buffer) and buffer[index].isspace():
                    index += 1
                if index < len(buffer) and buffer[index] == ",":
                    index += 1
                    continue
                break

            if index >= len(buffer):
                chunk = handle.read(chunk_size)
                if not chunk:
                    raise ValueError("Unexpected EOF while parsing elements")
                buffer += chunk
                continue

            if buffer[index] == "]":
                return

            try:
                value, next_index = decoder.raw_decode(buffer, index)
            except json.JSONDecodeError as decode_error:
                chunk = handle.read(chunk_size)
                if not chunk:
                    raise ValueError("Malformed Overpass JSON") from decode_error
                buffer += chunk
                continue

            if isinstance(value, dict):
                yield value

            index = next_index
            if index > chunk_size * 2:
                buffer = buffer[index:]
                index = 0


def survey_highways_from_overpass_json(path: Path) -> HighwaySurveySummary:
    node_coords: dict[int, tuple[float, float]] = {}
    highway_counts: Counter[str] = Counter()

    for element in iter_overpass_elements(path):
        element_type = element.get("type")

        if element_type == "node":
            osm_id = element.get("id")
            lat = element.get("lat")
            lon = element.get("lon")
            if (
                isinstance(osm_id, int)
                and isinstance(lat, float | int)
                and isinstance(lon, float | int)
            ):
                node_coords[osm_id] = (float(lat), float(lon))
            continue

        if element_type != "way":
            continue

        tags = element.get("tags")
        if not isinstance(tags, dict):
            continue

        highway = tags.get("highway")
        if isinstance(highway, str):
            highway_counts[highway] += 1

    total_node_refs = 0
    total_way_length_m = 0.0
    total_highway_way_count = 0
    missing_segment_count = 0

    for element in iter_overpass_elements(path):
        if element.get("type") != "way":
            continue

        tags = element.get("tags")
        if not isinstance(tags, dict):
            continue

        highway = tags.get("highway")
        if not isinstance(highway, str):
            continue

        nodes = element.get("nodes")
        if not isinstance(nodes, list) or len(nodes) < 2:
            continue

        node_ids = [node_id for node_id in nodes if isinstance(node_id, int)]
        if len(node_ids) < 2:
            continue

        total_highway_way_count += 1
        total_node_refs += len(node_ids)

        for node_a, node_b in zip(node_ids, node_ids[1:], strict=False):
            point_a = node_coords.get(node_a)
            point_b = node_coords.get(node_b)
            if point_a is None or point_b is None:
                missing_segment_count += 1
                continue

            total_way_length_m += haversine_m(
                point_a[0],
                point_a[1],
                point_b[0],
                point_b[1],
            )

    if total_way_length_m <= 0.0:
        node_refs_per_km: float | None = None
    else:
        node_refs_per_km = total_node_refs / (total_way_length_m / 1_000.0)

    pedestrian_highway_values = tuple(
        highway for highway in WALKABLE_HIGHWAY_VALUES if highway_counts.get(highway, 0) > 0
    )

    return HighwaySurveySummary(
        highway_counts=highway_counts,
        pedestrian_highway_values=pedestrian_highway_values,
        node_refs_per_km=node_refs_per_km,
        total_highway_way_count=total_highway_way_count,
        total_way_length_km=total_way_length_m / 1_000.0,
        missing_segment_count=missing_segment_count,
    )
