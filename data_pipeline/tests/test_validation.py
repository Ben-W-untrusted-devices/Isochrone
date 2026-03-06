from isochrone_pipeline.adjacency import AdjacencyGraph, GraphEdge, GraphNode
from isochrone_pipeline.validation import (
    LandmarkNodeMatch,
    find_nearest_node_index,
    validate_graph_integrity,
    validate_landmark_reachability,
)


def _graph(nodes: list[GraphNode], edges: list[GraphEdge]) -> AdjacencyGraph:
    return AdjacencyGraph(nodes=tuple(nodes), edges=tuple(edges), skipped_constraint_way_count=0)


def test_validate_graph_integrity_accepts_valid_graph() -> None:
    graph = _graph(
        nodes=[
            GraphNode(osm_id=1, x_m=0, y_m=0, first_edge_index=0, edge_count=1, flags=0),
            GraphNode(osm_id=2, x_m=10, y_m=0, first_edge_index=1, edge_count=1, flags=0),
        ],
        edges=[
            GraphEdge(source_index=0, target_index=1, cost_seconds=5, flags=0),
            GraphEdge(source_index=1, target_index=0, cost_seconds=5, flags=0),
        ],
    )

    result = validate_graph_integrity(graph)

    assert result.edge_count == 2
    assert result.out_of_range_edge_count == 0
    assert result.non_positive_cost_count == 0


def test_validate_graph_integrity_rejects_out_of_range_edges() -> None:
    graph = _graph(
        nodes=[
            GraphNode(osm_id=1, x_m=0, y_m=0, first_edge_index=0, edge_count=1, flags=0),
            GraphNode(osm_id=2, x_m=10, y_m=0, first_edge_index=1, edge_count=0, flags=0),
        ],
        edges=[
            GraphEdge(source_index=0, target_index=2, cost_seconds=5, flags=0),
        ],
    )

    try:
        validate_graph_integrity(graph)
    except ValueError as exc:
        assert "out-of-range" in str(exc)
    else:
        raise AssertionError("expected ValueError")


def test_validate_graph_integrity_rejects_non_positive_costs() -> None:
    graph = _graph(
        nodes=[
            GraphNode(osm_id=1, x_m=0, y_m=0, first_edge_index=0, edge_count=1, flags=0),
            GraphNode(osm_id=2, x_m=10, y_m=0, first_edge_index=1, edge_count=0, flags=0),
        ],
        edges=[
            GraphEdge(source_index=0, target_index=1, cost_seconds=0, flags=0),
        ],
    )

    try:
        validate_graph_integrity(graph)
    except ValueError as exc:
        assert "non-positive" in str(exc)
    else:
        raise AssertionError("expected ValueError")


def test_find_nearest_node_index_returns_closest_node() -> None:
    graph = _graph(
        nodes=[
            GraphNode(osm_id=1, x_m=0, y_m=0, first_edge_index=0, edge_count=0, flags=0),
            GraphNode(osm_id=2, x_m=10, y_m=0, first_edge_index=0, edge_count=0, flags=0),
            GraphNode(osm_id=3, x_m=5, y_m=5, first_edge_index=0, edge_count=0, flags=0),
        ],
        edges=[],
    )

    node_index, distance_m = find_nearest_node_index(graph, x_m=6, y_m=4)

    assert node_index == 2
    assert distance_m < 2.0


def test_validate_landmark_reachability_detects_unreachable_nodes() -> None:
    graph = _graph(
        nodes=[
            GraphNode(osm_id=1, x_m=0, y_m=0, first_edge_index=0, edge_count=1, flags=0),
            GraphNode(osm_id=2, x_m=10, y_m=0, first_edge_index=1, edge_count=1, flags=0),
            GraphNode(osm_id=3, x_m=20, y_m=0, first_edge_index=2, edge_count=0, flags=0),
        ],
        edges=[
            GraphEdge(source_index=0, target_index=1, cost_seconds=5, flags=0),
            GraphEdge(source_index=1, target_index=0, cost_seconds=5, flags=0),
        ],
    )

    matches = (
        LandmarkNodeMatch(name="A", node_index=0, node_osm_id=1, distance_m=1.0),
        LandmarkNodeMatch(name="B", node_index=1, node_osm_id=2, distance_m=1.0),
        LandmarkNodeMatch(name="C", node_index=2, node_osm_id=3, distance_m=1.0),
    )

    result = validate_landmark_reachability(graph, matches)

    assert result.all_reachable is False
    assert result.source_to_unreachable["A"] == ("C",)
    assert result.source_to_unreachable["B"] == ("C",)
    assert result.source_to_unreachable["C"] == ("A", "B")
