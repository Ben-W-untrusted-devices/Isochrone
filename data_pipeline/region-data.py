#!/usr/bin/env python3
"""Entry point for multi-region fetch/build artifact generation."""

from __future__ import annotations

import os
import sys
from pathlib import Path


def _project_venv_python(script_path: Path | None = None) -> Path:
    resolved_script_path = (script_path or Path(__file__)).resolve()
    return resolved_script_path.parents[1] / ".venv" / "bin" / "python"


def _resolve_reexec_python(
    *,
    current_executable: str,
    script_path: Path | None = None,
) -> Path | None:
    preferred_python = _project_venv_python(script_path)
    if not preferred_python.is_file() or not os.access(preferred_python, os.X_OK):
        return None

    current_python = Path(current_executable).resolve()
    if current_python == preferred_python.resolve():
        return None

    return preferred_python


def _maybe_reexec_with_project_venv() -> None:
    if os.environ.get("ISOCHRONE_REGION_DATA_ACTIVE_VENV") == "1":
        return

    preferred_python = _resolve_reexec_python(current_executable=sys.executable)
    if preferred_python is None:
        return

    exec_env = os.environ.copy()
    exec_env["ISOCHRONE_REGION_DATA_ACTIVE_VENV"] = "1"
    os.execve(
        str(preferred_python),
        [str(preferred_python), str(Path(__file__).resolve()), *sys.argv[1:]],
        exec_env,
    )


def _main() -> int:
    _maybe_reexec_with_project_venv()

    src_root = Path(__file__).resolve().parent / "src"
    if str(src_root) not in sys.path:
        sys.path.insert(0, str(src_root))

    from isochrone_pipeline.region_pipeline import main

    return main()


if __name__ == "__main__":
    raise SystemExit(_main())
