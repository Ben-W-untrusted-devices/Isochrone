"""Walking graph validation helpers for integrity and landmark reachability."""

from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass

from pyproj import Transformer

from .adjacency import AdjacencyGraph


@dataclass(frozen=True)
class GraphIntegrityResult:
    edge_count: int
    out_of_range_edge_count: int
    non_positive_cost_count: int


@dataclass(frozen=True)
class LandmarkNodeMatch:
    name: str
    node_index: int
    node_osm_id: int | None
    distance_m: float


@dataclass(frozen=True)
class LandmarkReachabilityResult:
    all_reachable: bool
    source_to_unreachable: dict[str, tuple[str, ...]]
    source_to_reachable_count: dict[str, int]


@dataclass(frozen=True)
class ValidationLocation:
    name: str
    lat: float
    lon: float


BERLIN_VALIDATION_LOCATIONS: tuple[ValidationLocation, ...] = (
    ValidationLocation(name="Brandenburg Gate", lat=52.516275, lon=13.377704),
    ValidationLocation(name="Alexanderplatz", lat=52.521918, lon=13.413215),
    ValidationLocation(name="Zoologischer Garten", lat=52.507087, lon=13.332578),
)


def validate_graph_integrity(graph: AdjacencyGraph) -> GraphIntegrityResult:
    node_count = len(graph.nodes)
    out_of_range_edge_count = 0
    non_positive_cost_count = 0

    for edge in graph.edges:
        if edge.source_index < 0 or edge.source_index >= node_count:
            out_of_range_edge_count += 1
        if edge.target_index < 0 or edge.target_index >= node_count:
            out_of_range_edge_count += 1
        if edge.cost_seconds <= 0:
            non_positive_cost_count += 1

    result = GraphIntegrityResult(
        edge_count=len(graph.edges),
        out_of_range_edge_count=out_of_range_edge_count,
        non_positive_cost_count=non_positive_cost_count,
    )

    if out_of_range_edge_count > 0:
        raise ValueError(
            f"validation failed: found out-of-range edge indices (count={out_of_range_edge_count})"
        )

    if non_positive_cost_count > 0:
        raise ValueError(
            f"validation failed: found non-positive edge costs (count={non_positive_cost_count})"
        )

    return result


def find_nearest_node_index(graph: AdjacencyGraph, *, x_m: int, y_m: int) -> tuple[int, float]:
    if not graph.nodes:
        raise ValueError("find_nearest_node_index requires at least one node")

    best_index = 0
    first = graph.nodes[0]
    best_dist_sq = (first.x_m - x_m) ** 2 + (first.y_m - y_m) ** 2

    for index, node in enumerate(graph.nodes[1:], start=1):
        dist_sq = (node.x_m - x_m) ** 2 + (node.y_m - y_m) ** 2
        if dist_sq < best_dist_sq:
            best_dist_sq = dist_sq
            best_index = index

    return best_index, math.sqrt(float(best_dist_sq))


def match_locations_to_nearest_nodes(
    graph: AdjacencyGraph,
    *,
    locations: tuple[ValidationLocation, ...],
    origin_easting: float,
    origin_northing: float,
    epsg_code: int,
) -> tuple[LandmarkNodeMatch, ...]:
    transformer = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg_code}", always_xy=True)
    matches: list[LandmarkNodeMatch] = []

    for location in locations:
        easting, northing = transformer.transform(location.lon, location.lat)
        x_m = int(round(float(easting) - origin_easting))
        y_m = int(round(float(northing) - origin_northing))

        node_index, distance_m = find_nearest_node_index(graph, x_m=x_m, y_m=y_m)
        matched_node = graph.nodes[node_index]

        matches.append(
            LandmarkNodeMatch(
                name=location.name,
                node_index=node_index,
                node_osm_id=matched_node.osm_id,
                distance_m=distance_m,
            )
        )

    return tuple(matches)


def validate_landmark_reachability(
    graph: AdjacencyGraph,
    landmarks: tuple[LandmarkNodeMatch, ...],
) -> LandmarkReachabilityResult:
    source_to_unreachable: dict[str, tuple[str, ...]] = {}
    source_to_reachable_count: dict[str, int] = {}

    for source in landmarks:
        visited, reachable_count = _bfs_reachable_mask(graph, source.node_index)
        unreachable = tuple(
            target.name
            for target in landmarks
            if target.node_index != source.node_index and visited[target.node_index] == 0
        )
        source_to_unreachable[source.name] = unreachable
        source_to_reachable_count[source.name] = reachable_count

    return LandmarkReachabilityResult(
        all_reachable=all(len(unreachable) == 0 for unreachable in source_to_unreachable.values()),
        source_to_unreachable=source_to_unreachable,
        source_to_reachable_count=source_to_reachable_count,
    )


def _bfs_reachable_mask(graph: AdjacencyGraph, start_index: int) -> tuple[bytearray, int]:
    node_count = len(graph.nodes)
    if start_index < 0 or start_index >= node_count:
        raise ValueError(f"start_index {start_index} out of range for node_count={node_count}")

    visited = bytearray(node_count)
    visited[start_index] = 1
    queue: deque[int] = deque([start_index])
    reachable_count = 1

    while queue:
        source_index = queue.popleft()
        node = graph.nodes[source_index]
        start = node.first_edge_index
        end = start + node.edge_count

        for edge in graph.edges[start:end]:
            target = edge.target_index
            if visited[target] != 0:
                continue
            visited[target] = 1
            reachable_count += 1
            queue.append(target)

    return visited, reachable_count
