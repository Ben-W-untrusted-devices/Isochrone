from __future__ import annotations

import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def _check_ignore(path: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "check-ignore", path],
        check=False,
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
    )


def test_benchmark_json_outputs_are_ignored_without_hiding_graph_artifacts() -> None:
    ignored_benchmark = _check_ignore("data_pipeline/output/routing-benchmark-stable-now.json")
    visible_graph = _check_ignore("data_pipeline/output/graph-walk.bin.gz")

    assert ignored_benchmark.returncode == 0
    assert visible_graph.returncode == 1
