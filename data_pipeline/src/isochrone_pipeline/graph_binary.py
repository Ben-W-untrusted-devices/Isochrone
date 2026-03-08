"""Binary graph export for graph schema v2."""

from __future__ import annotations

from dataclasses import dataclass

from .adjacency import AdjacencyGraph
from .binary_reader import EDGE_RECORD_SIZE, HEADER_SIZE, MAGIC, NODE_RECORD_SIZE
from .binary_writer import BinaryWriter
from .projection import ProjectionResult

FORMAT_VERSION = 2
TRANSIT_FLAG_BIT = 1 << 0


@dataclass(frozen=True)
class GraphBinaryOffsets:
    node_table_offset: int
    edge_table_offset: int
    stop_table_offset: int


def export_graph_binary_bytes(
    graph: AdjacencyGraph,
    *,
    projection: ProjectionResult,
) -> bytes:
    _validate_adjacency_layout(graph)

    n_nodes = len(graph.nodes)
    n_edges = len(graph.edges)
    n_stops = 0
    n_tedges = 0

    offsets = GraphBinaryOffsets(
        node_table_offset=HEADER_SIZE,
        edge_table_offset=HEADER_SIZE + (n_nodes * NODE_RECORD_SIZE),
        stop_table_offset=HEADER_SIZE + (n_nodes * NODE_RECORD_SIZE) + (n_edges * EDGE_RECORD_SIZE),
    )

    writer = BinaryWriter()

    # Header (64 bytes)
    writer.write_u32(MAGIC)
    writer.write_u8(FORMAT_VERSION)
    writer.write_u8(0 & TRANSIT_FLAG_BIT)
    writer.write_u16(0)

    writer.write_u32(n_nodes)
    writer.write_u32(n_edges)
    writer.write_u32(n_stops)
    writer.write_u32(n_tedges)

    writer.write_f64(projection.origin_easting)
    writer.write_f64(projection.origin_northing)

    writer.write_u16(projection.epsg_code)
    writer.write_u16(projection.grid_width_px)
    writer.write_u16(projection.grid_height_px)
    writer.write_u16(0)

    writer.write_f32(projection.pixel_size_m)

    writer.write_u32(offsets.node_table_offset)
    writer.write_u32(offsets.edge_table_offset)
    writer.write_u32(offsets.stop_table_offset)

    if writer.offset != HEADER_SIZE:
        raise ValueError(f"header serialized to {writer.offset} bytes, expected {HEADER_SIZE}")

    for node in graph.nodes:
        writer.write_i32(node.x_m)
        writer.write_i32(node.y_m)
        writer.write_u32(node.first_edge_index)
        writer.write_u16(node.edge_count)
        writer.write_u16(node.flags)

    for edge in graph.edges:
        writer.write_u32(edge.target_index)
        writer.write_u16(edge.cost_seconds)
        writer.write_u16(edge.flags)
        writer.write_u32(
            _pack_edge_metadata(
                mode_mask=edge.mode_mask,
                maxspeed_kph=edge.maxspeed_kph,
                road_class_id=edge.road_class_id,
            )
        )

    # MVP: stops and transit edges are empty tables.
    return writer.to_bytes()


def _validate_adjacency_layout(graph: AdjacencyGraph) -> None:
    edge_count = len(graph.edges)
    coverage = [0] * edge_count

    for node_index, node in enumerate(graph.nodes):
        start = node.first_edge_index
        end = start + node.edge_count

        if start < 0 or start > edge_count:
            raise ValueError(
                "node "
                f"{node_index} first_edge_index out of range: {start} "
                f"(edge_count={edge_count})"
            )
        if end < 0 or end > edge_count:
            raise ValueError(f"node {node_index} edge range out of bounds: [{start}, {end})")

        for edge_index in range(start, end):
            coverage[edge_index] += 1
            edge = graph.edges[edge_index]
            if edge.source_index != node_index:
                raise ValueError(
                    "edge source_index does not match node adjacency range: "
                    f"edge_index={edge_index} "
                    f"source_index={edge.source_index} "
                    f"node_index={node_index}"
                )
            if edge.mode_mask <= 0 or edge.mode_mask > 0xFF:
                raise ValueError(
                    f"edge mode_mask out of range at edge_index={edge_index}: {edge.mode_mask}"
                )
            if edge.maxspeed_kph < 0 or edge.maxspeed_kph > 0xFFFF:
                raise ValueError(
                    "edge maxspeed_kph out of range at "
                    f"edge_index={edge_index}: {edge.maxspeed_kph}"
                )
            if edge.road_class_id < 0 or edge.road_class_id > 0xFF:
                raise ValueError(
                    "edge road_class_id out of range at "
                    f"edge_index={edge_index}: {edge.road_class_id}"
                )

    gaps = [index for index, count in enumerate(coverage) if count == 0]
    overlaps = [index for index, count in enumerate(coverage) if count > 1]

    if gaps:
        raise ValueError(f"edge indices not referenced by node ranges: first_gap={gaps[0]}")
    if overlaps:
        raise ValueError(
            f"edge indices multiply referenced by node ranges: first_overlap={overlaps[0]}"
        )


def _pack_edge_metadata(*, mode_mask: int, maxspeed_kph: int, road_class_id: int) -> int:
    return (maxspeed_kph << 16) | (road_class_id << 8) | mode_mask
