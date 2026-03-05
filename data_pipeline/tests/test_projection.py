import math

from isochrone_pipeline.projection import project_nodes_to_utm


def test_project_nodes_to_utm_returns_offsets_and_grid() -> None:
    nodes = {
        1: (52.5200, 13.4050),
        2: (52.5205, 13.4060),
        3: (52.5210, 13.4070),
    }

    result = project_nodes_to_utm(nodes)

    assert result.epsg_code == 25833
    assert result.origin_easting <= result.max_easting
    assert result.origin_northing <= result.max_northing
    assert result.grid_width_px == math.ceil((result.max_easting - result.origin_easting) / 10.0)
    assert result.grid_height_px == math.ceil((result.max_northing - result.origin_northing) / 10.0)

    for node_id, (x_m, y_m) in result.node_offsets_m.items():
        assert node_id in nodes
        assert isinstance(x_m, int)
        assert isinstance(y_m, int)
        assert x_m >= 0
        assert y_m >= 0


def test_project_nodes_to_utm_rejects_empty_input() -> None:
    try:
        project_nodes_to_utm({})
    except ValueError as exc:
        assert "at least one node" in str(exc)
    else:
        raise AssertionError("expected ValueError")
