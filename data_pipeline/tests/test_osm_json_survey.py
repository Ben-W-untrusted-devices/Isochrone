from pathlib import Path

from isochrone_pipeline.osm_json_survey import (
    iter_overpass_elements,
    survey_highways_from_overpass_json,
)


def _write_fixture(path: Path) -> None:
    path.write_text(
        """
{
  "version": 0.6,
  "elements": [
    {"type": "node", "id": 1, "lat": 52.5, "lon": 13.4},
    {"type": "node", "id": 2, "lat": 52.5, "lon": 13.41},
    {"type": "node", "id": 3, "lat": 52.5, "lon": 13.42},
    {"type": "way", "id": 10, "nodes": [1, 2, 3], "tags": {"highway": "footway"}},
    {"type": "way", "id": 11, "nodes": [2, 3], "tags": {"highway": "residential"}},
    {"type": "way", "id": 12, "nodes": [2, 999], "tags": {"highway": "footway"}}
  ]
}
""".strip(),
        encoding="utf-8",
    )


def test_iter_overpass_elements_yields_elements_in_order(tmp_path: Path) -> None:
    source = tmp_path / "sample.json"
    _write_fixture(source)

    elements = list(iter_overpass_elements(source))

    assert len(elements) == 6
    assert elements[0]["type"] == "node"
    assert elements[-1]["type"] == "way"


def test_survey_highways_from_overpass_json_reports_counts_and_density(tmp_path: Path) -> None:
    source = tmp_path / "sample.json"
    _write_fixture(source)

    summary = survey_highways_from_overpass_json(source)

    assert summary.highway_counts["footway"] == 2
    assert summary.highway_counts["residential"] == 1
    assert summary.total_highway_way_count == 3
    assert summary.missing_segment_count == 1
    assert "footway" in summary.pedestrian_highway_values
    assert "residential" in summary.pedestrian_highway_values
    assert summary.node_refs_per_km is not None
    assert 3.0 <= summary.node_refs_per_km <= 4.2
