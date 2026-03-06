"""Shortest-path routing helpers on the simplified walking graph."""

from __future__ import annotations

import heapq
import math
from dataclasses import dataclass

from .adjacency import AdjacencyGraph


@dataclass(frozen=True)
class RouteResult:
    start_osm_id: int
    goal_osm_id: int
    path_node_indices: tuple[int, ...]
    path_node_osm_ids: tuple[int | None, ...]
    total_cost_seconds: int
    expanded_node_count: int
    heuristic_cost_per_meter: float


def astar_route_by_osm_ids(
    graph: AdjacencyGraph,
    *,
    start_osm_id: int,
    goal_osm_id: int,
) -> RouteResult:
    osm_id_to_index = _build_osm_id_index(graph)

    try:
        start_index = osm_id_to_index[start_osm_id]
    except KeyError as exc:
        raise ValueError(f"start OSM node id {start_osm_id} is not present in graph") from exc

    try:
        goal_index = osm_id_to_index[goal_osm_id]
    except KeyError as exc:
        raise ValueError(f"goal OSM node id {goal_osm_id} is not present in graph") from exc

    (
        path_node_indices,
        total_cost_seconds,
        expanded_count,
        min_cost_per_meter,
    ) = _astar_route_indices(
        graph,
        start_index=start_index,
        goal_index=goal_index,
    )

    return RouteResult(
        start_osm_id=start_osm_id,
        goal_osm_id=goal_osm_id,
        path_node_indices=path_node_indices,
        path_node_osm_ids=tuple(graph.nodes[index].osm_id for index in path_node_indices),
        total_cost_seconds=total_cost_seconds,
        expanded_node_count=expanded_count,
        heuristic_cost_per_meter=min_cost_per_meter,
    )


def _build_osm_id_index(graph: AdjacencyGraph) -> dict[int, int]:
    osm_id_to_index: dict[int, int] = {}

    for index, node in enumerate(graph.nodes):
        if node.osm_id is None:
            continue
        osm_id_to_index[node.osm_id] = index

    return osm_id_to_index


def _astar_route_indices(
    graph: AdjacencyGraph,
    *,
    start_index: int,
    goal_index: int,
) -> tuple[tuple[int, ...], int, int, float]:
    node_count = len(graph.nodes)
    if start_index < 0 or start_index >= node_count:
        raise ValueError(f"start_index {start_index} out of range")
    if goal_index < 0 or goal_index >= node_count:
        raise ValueError(f"goal_index {goal_index} out of range")

    if start_index == goal_index:
        return (start_index,), 0, 0, 0.0

    min_cost_per_meter = _compute_min_cost_per_meter(graph)

    inf = float("inf")
    g_score: list[float] = [inf] * node_count
    came_from: list[int] = [-1] * node_count
    closed = bytearray(node_count)

    g_score[start_index] = 0.0
    open_heap: list[tuple[float, int, int]] = [
        (_heuristic(graph, start_index, goal_index, min_cost_per_meter), 0, start_index)
    ]
    expanded_count = 0

    while open_heap:
        _, best_g_int, node_index = heapq.heappop(open_heap)

        if closed[node_index] != 0:
            continue

        if int(g_score[node_index]) != best_g_int:
            continue

        closed[node_index] = 1
        expanded_count += 1

        if node_index == goal_index:
            path = _reconstruct_path(came_from, start_index=start_index, goal_index=goal_index)
            return path, int(g_score[goal_index]), expanded_count, min_cost_per_meter

        node = graph.nodes[node_index]
        start_edge = node.first_edge_index
        end_edge = start_edge + node.edge_count

        for edge in graph.edges[start_edge:end_edge]:
            target = edge.target_index
            if closed[target] != 0:
                continue

            tentative_g = g_score[node_index] + float(edge.cost_seconds)
            if tentative_g >= g_score[target]:
                continue

            g_score[target] = tentative_g
            came_from[target] = node_index
            heuristic = _heuristic(graph, target, goal_index, min_cost_per_meter)
            heapq.heappush(open_heap, (tentative_g + heuristic, int(tentative_g), target))

    raise ValueError(
        "no route found between node indices "
        f"{start_index} and {goal_index}; graph may be disconnected"
    )


def _compute_min_cost_per_meter(graph: AdjacencyGraph) -> float:
    min_ratio = float("inf")

    for edge in graph.edges:
        source = graph.nodes[edge.source_index]
        target = graph.nodes[edge.target_index]
        distance_m = math.hypot(float(target.x_m - source.x_m), float(target.y_m - source.y_m))
        if distance_m <= 0.0:
            continue

        ratio = float(edge.cost_seconds) / distance_m
        if ratio < min_ratio:
            min_ratio = ratio

    if not math.isfinite(min_ratio):
        return 0.0

    return min_ratio


def _heuristic(
    graph: AdjacencyGraph,
    source_index: int,
    goal_index: int,
    min_cost_per_meter: float,
) -> float:
    if min_cost_per_meter <= 0.0:
        return 0.0

    source = graph.nodes[source_index]
    goal = graph.nodes[goal_index]
    straight_line_m = math.hypot(float(goal.x_m - source.x_m), float(goal.y_m - source.y_m))

    # floor() keeps heuristic safely <= lower bound induced by the edge cost metric.
    return math.floor(min_cost_per_meter * straight_line_m)


def _reconstruct_path(
    came_from: list[int],
    *,
    start_index: int,
    goal_index: int,
) -> tuple[int, ...]:
    path = [goal_index]
    current = goal_index

    while current != start_index:
        current = came_from[current]
        if current < 0:
            raise ValueError("failed to reconstruct route path")
        path.append(current)

    path.reverse()
    return tuple(path)
