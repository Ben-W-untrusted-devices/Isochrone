from __future__ import annotations

import os
import stat
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DOCS_ROOT = REPO_ROOT / "docs"
PIPELINE_ROOT = REPO_ROOT / "data_pipeline"


def _run_zsh_script(
    script_path: Path,
    *args: str,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["zsh", str(script_path), *args],
        check=False,
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
        env=env,
    )


def test_routing_query_script_renders_location_selector() -> None:
    script_path = DOCS_ROOT / "berlin_overpass_routing_query.ql"
    result = _run_zsh_script(
        script_path,
        "--location-label",
        "Paris",
        "--location-relation",
        'rel["boundary"="administrative"]["wikidata"="Q90"]',
    )

    assert result.returncode == 0, result.stderr
    assert "Paris routing-focused OSM extraction" in result.stdout
    assert 'rel["boundary"="administrative"]["wikidata"="Q90"]->.placeRel;' in result.stdout
    assert ".placeRel map_to_area->.searchArea;" in result.stdout
    assert 'way(area.searchArea)["highway"];' in result.stdout


def test_boundary_query_script_renders_location_selector_and_admin_level() -> None:
    script_path = DOCS_ROOT / "berlin_district_boundaries_query.ql"
    result = _run_zsh_script(
        script_path,
        "--location-label",
        "Luxembourg (country)",
        "--location-relation",
        'rel["boundary"="administrative"]["wikidata"="Q32"]',
        "--subdivision-admin-level",
        "8",
    )

    assert result.returncode == 0, result.stderr
    assert "Luxembourg (country) subdivision boundaries" in result.stdout
    assert 'rel["boundary"="administrative"]["wikidata"="Q32"]->.placeRel;' in result.stdout
    assert '["admin_level"="8"]->.subdivisions;' in result.stdout
    assert "out body geom qt;" in result.stdout


def test_fetch_data_script_loops_default_locations_and_writes_outputs(tmp_path: Path) -> None:
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    fake_curl = fake_bin / "curl"
    fake_log = tmp_path / "curl.log"
    fake_curl.write_text(
        "#!/bin/sh\n"
        "set -eu\n"
        'output=""\n'
        'while [ "$#" -gt 0 ]; do\n'
        '  case "$1" in\n'
        "    -o)\n"
        '      output="$2"\n'
        "      shift 2\n"
        "      ;;\n"
        "    *)\n"
        "      shift\n"
        "      ;;\n"
        "  esac\n"
        "done\n"
        'if [ -z "$output" ]; then\n'
        '  echo "missing output path" >&2\n'
        "  exit 1\n"
        "fi\n"
        'mkdir -p "$(dirname "$output")"\n'
        'printf \'{"elements": []}\\n\' > "$output"\n'
        f"printf 'OUTPUT=%s\\n' \"$output\" >> {str(fake_log)!r}\n",
        encoding="utf-8",
    )
    fake_curl.chmod(fake_curl.stat().st_mode | stat.S_IXUSR)

    input_dir = tmp_path / "input"
    env = os.environ.copy()
    env["PATH"] = f"{fake_bin}:{env['PATH']}"
    env["INPUT_DIR"] = str(input_dir)
    result = _run_zsh_script(PIPELINE_ROOT / "fetch-data.sh", env=env)

    assert result.returncode == 0, result.stderr

    expected_outputs = [
        input_dir / "berlin-routing.osm.json",
        input_dir / "berlin-district-boundaries.osm.json",
        input_dir / "paris-routing.osm.json",
        input_dir / "paris-district-boundaries.osm.json",
        input_dir / "london-routing.osm.json",
        input_dir / "london-district-boundaries.osm.json",
        input_dir / "rome-routing.osm.json",
        input_dir / "rome-district-boundaries.osm.json",
        input_dir / "luxembourg-country-routing.osm.json",
        input_dir / "luxembourg-country-district-boundaries.osm.json",
    ]

    for output_path in expected_outputs:
        assert output_path.is_file(), f"missing output: {output_path}"

    logged_outputs = [
        line.removeprefix("OUTPUT=").strip()
        for line in fake_log.read_text(encoding="utf-8").splitlines()
        if line.startswith("OUTPUT=")
    ]
    assert logged_outputs == [str(path) for path in expected_outputs]
