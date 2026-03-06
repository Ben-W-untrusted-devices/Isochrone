from isochrone_pipeline.boundary_canvas import (
    extract_overpass_boundary_features,
    simplify_overpass_boundaries_for_canvas,
    simplify_polyline,
)

SAMPLE_OVERPASS = {
    "elements": [
        {
            "type": "relation",
            "id": 100,
            "tags": {
                "boundary": "administrative",
                "type": "boundary",
                "admin_level": "9",
                "name": "Mitte",
            },
            "members": [
                {
                    "type": "way",
                    "geometry": [
                        {"lat": 52.5200, "lon": 13.3700},
                        {"lat": 52.5205, "lon": 13.3750},
                        {"lat": 52.5210, "lon": 13.3800},
                    ],
                }
            ],
        },
        {
            "type": "relation",
            "id": 200,
            "tags": {
                "boundary": "administrative",
                "type": "boundary",
                "admin_level": "10",
                "name": "ShouldBeIgnored",
            },
            "members": [],
        },
    ]
}


def test_extract_overpass_boundary_features_filters_admin_level() -> None:
    features = extract_overpass_boundary_features(SAMPLE_OVERPASS, admin_level="9")

    assert len(features) == 1
    assert features[0].relation_id == 100
    assert features[0].name == "Mitte"
    assert len(features[0].paths_lat_lon) == 1


def test_simplify_polyline_reduces_nearly_collinear_points() -> None:
    points = ((0.0, 0.0), (0.5, 0.01), (1.0, 0.0))

    simplified = simplify_polyline(points, tolerance=0.05)

    assert simplified == ((0.0, 0.0), (1.0, 0.0))


def test_simplify_overpass_boundaries_for_canvas_degrees() -> None:
    payload = simplify_overpass_boundaries_for_canvas(
        SAMPLE_OVERPASS,
        tolerance=0.0,
        units="degrees",
        admin_level="9",
    )

    assert payload["coordinate_space"]["units"] == "degrees"
    assert payload["coordinate_space"]["projection"] == "EPSG:4326"
    assert payload["stats"]["feature_count"] == 1
    assert payload["stats"]["input_point_count"] == payload["stats"]["output_point_count"]

    first_path = payload["features"][0]["paths"][0]
    assert first_path[0][0] >= 0.0
    assert first_path[0][1] >= 0.0


def test_simplify_overpass_boundaries_for_canvas_meters() -> None:
    payload = simplify_overpass_boundaries_for_canvas(
        SAMPLE_OVERPASS,
        tolerance=25.0,
        units="meters",
        epsg_code=25833,
        admin_level="9",
    )

    assert payload["coordinate_space"]["units"] == "meters"
    assert payload["coordinate_space"]["projection"] == "EPSG:25833"
    assert payload["stats"]["output_point_count"] <= payload["stats"]["input_point_count"]
