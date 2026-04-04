from __future__ import annotations

import importlib.util
import stat
from pathlib import Path
from types import ModuleType

REPO_ROOT = Path(__file__).resolve().parents[2]
ENTRYPOINT_PATH = REPO_ROOT / "data_pipeline" / "region-data.py"


def load_region_data_entrypoint_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("region_data_entrypoint", ENTRYPOINT_PATH)
    assert spec is not None
    assert spec.loader is not None

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_project_venv_python_is_resolved_relative_to_repo_root(tmp_path: Path) -> None:
    module = load_region_data_entrypoint_module()
    script_path = tmp_path / "repo" / "data_pipeline" / "region-data.py"

    expected_python = tmp_path / "repo" / ".venv" / "bin" / "python"
    assert module._project_venv_python(script_path) == expected_python


def test_resolve_reexec_python_prefers_project_venv_when_current_interpreter_differs(
    tmp_path: Path,
) -> None:
    module = load_region_data_entrypoint_module()
    script_path = tmp_path / "repo" / "data_pipeline" / "region-data.py"
    venv_python = tmp_path / "repo" / ".venv" / "bin" / "python"
    venv_python.parent.mkdir(parents=True)
    venv_python.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    venv_python.chmod(venv_python.stat().st_mode | stat.S_IXUSR)

    resolved_python = module._resolve_reexec_python(
        current_executable="/usr/bin/python3",
        script_path=script_path,
    )

    assert resolved_python == venv_python


def test_resolve_reexec_python_skips_when_current_interpreter_is_project_venv(
    tmp_path: Path,
) -> None:
    module = load_region_data_entrypoint_module()
    script_path = tmp_path / "repo" / "data_pipeline" / "region-data.py"
    venv_python = tmp_path / "repo" / ".venv" / "bin" / "python"
    venv_python.parent.mkdir(parents=True)
    venv_python.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    venv_python.chmod(venv_python.stat().st_mode | stat.S_IXUSR)

    resolved_python = module._resolve_reexec_python(
        current_executable=str(venv_python),
        script_path=script_path,
    )

    assert resolved_python is None


def test_resolve_reexec_python_skips_when_project_venv_is_missing(tmp_path: Path) -> None:
    module = load_region_data_entrypoint_module()
    script_path = tmp_path / "repo" / "data_pipeline" / "region-data.py"

    resolved_python = module._resolve_reexec_python(
        current_executable="/usr/bin/python3",
        script_path=script_path,
    )

    assert resolved_python is None
