import pytest
from isochrone_pipeline.adjacency import AdjacencyGraph, GraphEdge, GraphNode
from isochrone_pipeline.binary_reader import (
    EDGE_RECORD_SIZE,
    HEADER_SIZE,
    NODE_RECORD_SIZE,
    parse_edge_record,
    parse_header,
    parse_node_record,
)
from isochrone_pipeline.graph_binary import export_graph_binary_bytes
from isochrone_pipeline.projection import ProjectionResult


def _projection() -> ProjectionResult:
    return ProjectionResult(
        epsg_code=25833,
        pixel_size_m=10.0,
        origin_easting=392000.0,
        origin_northing=5820000.0,
        max_easting=392100.0,
        max_northing=5820100.0,
        grid_width_px=10,
        grid_height_px=10,
        node_offsets_m={1: (0, 0), 2: (10, 0), 3: (20, 0)},
    )


def test_export_graph_binary_bytes_writes_header_nodes_and_edges() -> None:
    graph = AdjacencyGraph(
        nodes=(
            GraphNode(osm_id=1, x_m=0, y_m=0, first_edge_index=0, edge_count=1, flags=0),
            GraphNode(osm_id=2, x_m=10, y_m=0, first_edge_index=1, edge_count=1, flags=0),
            GraphNode(osm_id=3, x_m=20, y_m=0, first_edge_index=2, edge_count=0, flags=0),
        ),
        edges=(
            GraphEdge(
                source_index=0,
                target_index=1,
                cost_seconds=7,
                flags=2,
                mode_mask=0b0000_0111,
                maxspeed_kph=50,
                road_class_id=9,
            ),
            GraphEdge(
                source_index=1,
                target_index=2,
                cost_seconds=9,
                flags=4,
                mode_mask=0b0000_0001,
                maxspeed_kph=20,
                road_class_id=3,
            ),
        ),
        skipped_constraint_way_count=0,
    )

    payload = export_graph_binary_bytes(graph, projection=_projection())

    header = parse_header(payload)
    assert header.version == 2
    assert header.flags == 0
    assert header.n_nodes == 3
    assert header.n_edges == 2
    assert header.n_stops == 0
    assert header.n_tedges == 0
    assert header.origin_easting == 392000.0
    assert header.origin_northing == 5820000.0
    assert header.epsg_code == 25833
    assert header.grid_width_px == 10
    assert header.grid_height_px == 10
    assert header.pixel_size_m == 10.0

    assert header.node_table_offset == HEADER_SIZE
    assert header.edge_table_offset == HEADER_SIZE + (3 * NODE_RECORD_SIZE)
    assert header.stop_table_offset == header.edge_table_offset + (2 * EDGE_RECORD_SIZE)
    assert len(payload) == header.stop_table_offset

    node0 = parse_node_record(payload, header.node_table_offset)
    node1 = parse_node_record(payload, header.node_table_offset + NODE_RECORD_SIZE)
    edge0 = parse_edge_record(payload, header.edge_table_offset)
    edge1 = parse_edge_record(payload, header.edge_table_offset + EDGE_RECORD_SIZE)

    assert node0.x_m == 0
    assert node0.first_edge_index == 0
    assert node0.edge_count == 1
    assert node1.x_m == 10
    assert node1.first_edge_index == 1

    assert edge0.target_node_index == 1
    assert edge0.cost_seconds == 7
    assert edge0.flags == 2
    assert edge0.mode_mask == 0b0000_0111
    assert edge0.maxspeed_kph == 50
    assert edge0.road_class_id == 9

    assert edge1.target_node_index == 2
    assert edge1.cost_seconds == 9
    assert edge1.flags == 4
    assert edge1.mode_mask == 0b0000_0001
    assert edge1.maxspeed_kph == 20
    assert edge1.road_class_id == 3


def test_export_graph_binary_bytes_rejects_invalid_node_edge_layout() -> None:
    graph = AdjacencyGraph(
        nodes=(
            GraphNode(osm_id=1, x_m=0, y_m=0, first_edge_index=0, edge_count=1, flags=0),
            GraphNode(osm_id=2, x_m=10, y_m=0, first_edge_index=1, edge_count=0, flags=0),
        ),
        edges=(GraphEdge(source_index=1, target_index=0, cost_seconds=7, flags=0),),
        skipped_constraint_way_count=0,
    )

    with pytest.raises(ValueError, match="source_index"):
        export_graph_binary_bytes(graph, projection=_projection())
