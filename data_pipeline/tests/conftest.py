from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path

TEST_SUPPORT_ROOT = Path(__file__).resolve().parents[1]
python_path_entries = [
    str(TEST_SUPPORT_ROOT),
    *(entry for entry in os.environ.get("PYTHONPATH", "").split(os.pathsep) if entry),
]
os.environ["PYTHONPATH"] = os.pathsep.join(dict.fromkeys(python_path_entries))
os.environ["ISOCHRONE_TESTS_BLOCK_NETWORK"] = "1"

if str(TEST_SUPPORT_ROOT) not in sys.path:
    sys.path.insert(0, str(TEST_SUPPORT_ROOT))

spec = importlib.util.spec_from_file_location(
    "isochrone_test_no_network_guard",
    TEST_SUPPORT_ROOT / "no_network_guard.py",
)
assert spec is not None
assert spec.loader is not None
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

module.install_network_guard()
