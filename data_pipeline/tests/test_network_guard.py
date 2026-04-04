from __future__ import annotations

import os
import socket
import subprocess
import sys

import pytest


def test_python_tests_install_no_network_guard() -> None:
    assert os.environ["ISOCHRONE_TESTS_BLOCK_NETWORK"] == "1"
    assert os.environ["ISOCHRONE_TESTS_NETWORK_GUARD_ACTIVE"] == "1"
    assert socket.create_connection.__name__ == "_blocked_create_connection"
    assert socket.socket.connect.__name__ == "_blocked_socket_connect"


def test_python_subprocesses_inherit_no_network_guard() -> None:
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "import os, socket; "
                "print(os.environ['ISOCHRONE_TESTS_NETWORK_GUARD_ACTIVE']); "
                "print(socket.create_connection.__name__)"
            ),
        ],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout.splitlines() == ["1", "_blocked_create_connection"]


def test_python_tests_block_network_subprocess_commands() -> None:
    with pytest.raises(RuntimeError, match="Automatic tests must not make network calls"):
        subprocess.run(
            ["curl", "https://example.test/"],
            check=False,
            capture_output=True,
            text=True,
        )
