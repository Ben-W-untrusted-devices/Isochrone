"""Projection helpers for converting WGS84 node coordinates into UTM offsets."""

from __future__ import annotations

import math
from dataclasses import dataclass

from pyproj import Transformer

DEFAULT_EPSG_CODE = 25833
DEFAULT_PIXEL_SIZE_M = 10.0


@dataclass(frozen=True)
class ProjectionResult:
    epsg_code: int
    pixel_size_m: float
    origin_easting: float
    origin_northing: float
    max_easting: float
    max_northing: float
    grid_width_px: int
    grid_height_px: int
    node_offsets_m: dict[int, tuple[int, int]]


def project_nodes_to_utm(
    node_coords_lat_lon: dict[int, tuple[float, float]],
    *,
    epsg_code: int = DEFAULT_EPSG_CODE,
    pixel_size_m: float = DEFAULT_PIXEL_SIZE_M,
) -> ProjectionResult:
    if not node_coords_lat_lon:
        raise ValueError("project_nodes_to_utm requires at least one node")

    transformer = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg_code}", always_xy=True)

    projected_xy: dict[int, tuple[float, float]] = {}

    for node_id, (lat, lon) in node_coords_lat_lon.items():
        easting, northing = transformer.transform(lon, lat)
        projected_xy[node_id] = (float(easting), float(northing))

    eastings = [xy[0] for xy in projected_xy.values()]
    northings = [xy[1] for xy in projected_xy.values()]

    origin_easting = min(eastings)
    origin_northing = min(northings)
    max_easting = max(eastings)
    max_northing = max(northings)

    grid_width_px = math.ceil((max_easting - origin_easting) / pixel_size_m)
    grid_height_px = math.ceil((max_northing - origin_northing) / pixel_size_m)

    node_offsets_m: dict[int, tuple[int, int]] = {}
    for node_id, (easting, northing) in projected_xy.items():
        x_m = int(round(easting - origin_easting))
        y_m = int(round(northing - origin_northing))
        node_offsets_m[node_id] = (x_m, y_m)

    return ProjectionResult(
        epsg_code=epsg_code,
        pixel_size_m=pixel_size_m,
        origin_easting=origin_easting,
        origin_northing=origin_northing,
        max_easting=max_easting,
        max_northing=max_northing,
        grid_width_px=grid_width_px,
        grid_height_px=grid_height_px,
        node_offsets_m=node_offsets_m,
    )
