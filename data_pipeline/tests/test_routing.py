from isochrone_pipeline.adjacency import AdjacencyGraph, GraphEdge, GraphNode
from isochrone_pipeline.routing import RouteResult, astar_route_by_osm_ids


def _graph(nodes: list[GraphNode], edges: list[GraphEdge]) -> AdjacencyGraph:
    return AdjacencyGraph(nodes=tuple(nodes), edges=tuple(edges), skipped_constraint_way_count=0)


def test_astar_route_by_osm_ids_returns_shortest_path() -> None:
    graph = _graph(
        nodes=[
            GraphNode(osm_id=100, x_m=0, y_m=0, first_edge_index=0, edge_count=2, flags=0),
            GraphNode(osm_id=101, x_m=10, y_m=0, first_edge_index=2, edge_count=1, flags=0),
            GraphNode(osm_id=102, x_m=0, y_m=10, first_edge_index=3, edge_count=1, flags=0),
            GraphNode(osm_id=103, x_m=20, y_m=0, first_edge_index=4, edge_count=0, flags=0),
        ],
        edges=[
            GraphEdge(source_index=0, target_index=1, cost_seconds=5, flags=0),
            GraphEdge(source_index=0, target_index=2, cost_seconds=3, flags=0),
            GraphEdge(source_index=1, target_index=3, cost_seconds=5, flags=0),
            GraphEdge(source_index=2, target_index=3, cost_seconds=20, flags=0),
        ],
    )

    route: RouteResult = astar_route_by_osm_ids(
        graph,
        start_osm_id=100,
        goal_osm_id=103,
    )

    assert route.total_cost_seconds == 10
    assert route.path_node_osm_ids == (100, 101, 103)
    assert route.path_node_indices == (0, 1, 3)


def test_astar_route_by_osm_ids_handles_same_start_goal() -> None:
    graph = _graph(
        nodes=[
            GraphNode(osm_id=100, x_m=0, y_m=0, first_edge_index=0, edge_count=0, flags=0),
        ],
        edges=[],
    )

    route = astar_route_by_osm_ids(graph, start_osm_id=100, goal_osm_id=100)

    assert route.total_cost_seconds == 0
    assert route.path_node_osm_ids == (100,)


def test_astar_route_by_osm_ids_rejects_unknown_osm_id() -> None:
    graph = _graph(
        nodes=[
            GraphNode(osm_id=100, x_m=0, y_m=0, first_edge_index=0, edge_count=0, flags=0),
        ],
        edges=[],
    )

    try:
        astar_route_by_osm_ids(graph, start_osm_id=999, goal_osm_id=100)
    except ValueError as exc:
        assert "not present" in str(exc)
    else:
        raise AssertionError("expected ValueError")
