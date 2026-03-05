"""Extraction pipeline for walkable graph input from Overpass JSON."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .osm_json_survey import iter_overpass_elements
from .overpass_survey import WALKABLE_HIGHWAY_VALUES

CONSTRAINT_TAGS: tuple[str, ...] = ("access", "foot", "oneway", "oneway:foot", "sidewalk")


@dataclass(frozen=True)
class WayCandidate:
    osm_id: int
    highway: str
    node_ids: tuple[int, ...]
    constraints: dict[str, str]


@dataclass(frozen=True)
class ConnectorNode:
    osm_id: int
    lat: float
    lon: float
    connector_types: tuple[str, ...]


@dataclass(frozen=True)
class WayPassResult:
    ways: tuple[WayCandidate, ...]
    referenced_node_ids: set[int]


@dataclass(frozen=True)
class WalkableGraphExtract:
    ways: tuple[WayCandidate, ...]
    node_coords: dict[int, tuple[float, float]]
    connector_nodes: dict[int, ConnectorNode]
    dropped_way_count: int


def collect_walkable_way_candidates(
    path: Path,
    walkable_highways: set[str] | None = None,
) -> WayPassResult:
    allowed = walkable_highways or set(WALKABLE_HIGHWAY_VALUES)

    ways: list[WayCandidate] = []
    referenced_node_ids: set[int] = set()

    for element in iter_overpass_elements(path):
        if element.get("type") != "way":
            continue

        tags = element.get("tags")
        if not isinstance(tags, dict):
            continue

        highway = tags.get("highway")
        if not isinstance(highway, str) or highway not in allowed:
            continue

        nodes = element.get("nodes")
        if not isinstance(nodes, list):
            continue

        node_ids = tuple(node_id for node_id in nodes if isinstance(node_id, int))
        if len(node_ids) < 2:
            continue

        osm_id = element.get("id")
        if not isinstance(osm_id, int):
            continue

        constraints: dict[str, str] = {}
        for tag in CONSTRAINT_TAGS:
            tag_value = tags.get(tag)
            if isinstance(tag_value, str):
                constraints[tag] = tag_value

        ways.append(
            WayCandidate(
                osm_id=osm_id,
                highway=highway,
                node_ids=node_ids,
                constraints=constraints,
            )
        )
        referenced_node_ids.update(node_ids)

    return WayPassResult(ways=tuple(ways), referenced_node_ids=referenced_node_ids)


def load_referenced_nodes(
    path: Path,
    referenced_node_ids: set[int],
) -> dict[int, tuple[float, float]]:
    if not referenced_node_ids:
        return {}

    coords: dict[int, tuple[float, float]] = {}
    for element in iter_overpass_elements(path):
        if element.get("type") != "node":
            continue

        osm_id = element.get("id")
        if not isinstance(osm_id, int) or osm_id not in referenced_node_ids:
            continue

        lat = element.get("lat")
        lon = element.get("lon")
        if not isinstance(lat, float | int) or not isinstance(lon, float | int):
            continue

        coords[osm_id] = (float(lat), float(lon))

        if len(coords) == len(referenced_node_ids):
            break

    return coords


def collect_connector_nodes(path: Path) -> dict[int, ConnectorNode]:
    connectors: dict[int, ConnectorNode] = {}

    for element in iter_overpass_elements(path):
        if element.get("type") != "node":
            continue

        tags = element.get("tags")
        if not isinstance(tags, dict):
            continue

        connector_types: list[str] = []

        if "barrier" in tags:
            connector_types.append("barrier")
        if tags.get("highway") == "crossing":
            connector_types.append("crossing")
        if tags.get("railway") == "level_crossing":
            connector_types.append("level_crossing")
        if "entrance" in tags:
            connector_types.append("entrance")

        if not connector_types:
            continue

        osm_id = element.get("id")
        lat = element.get("lat")
        lon = element.get("lon")

        if not isinstance(osm_id, int):
            continue
        if not isinstance(lat, float | int) or not isinstance(lon, float | int):
            continue

        connectors[osm_id] = ConnectorNode(
            osm_id=osm_id,
            lat=float(lat),
            lon=float(lon),
            connector_types=tuple(connector_types),
        )

    return connectors


def drop_ways_with_missing_nodes(
    ways: tuple[WayCandidate, ...],
    node_coords: dict[int, tuple[float, float]],
) -> tuple[tuple[WayCandidate, ...], int]:
    kept: list[WayCandidate] = []
    dropped = 0

    for way in ways:
        if all(node_id in node_coords for node_id in way.node_ids):
            kept.append(way)
        else:
            dropped += 1

    return tuple(kept), dropped


def extract_walkable_graph_input(
    path: Path,
    walkable_highways: set[str] | None = None,
) -> WalkableGraphExtract:
    pass1 = collect_walkable_way_candidates(path, walkable_highways=walkable_highways)
    node_coords = load_referenced_nodes(path, pass1.referenced_node_ids)
    connector_nodes = collect_connector_nodes(path)
    kept_ways, dropped_way_count = drop_ways_with_missing_nodes(pass1.ways, node_coords)

    return WalkableGraphExtract(
        ways=kept_ways,
        node_coords=node_coords,
        connector_nodes=connector_nodes,
        dropped_way_count=dropped_way_count,
    )
