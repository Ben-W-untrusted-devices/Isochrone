from __future__ import annotations

import os
import shutil
import socket
import subprocess
from pathlib import Path
from typing import Any

_GUARD_MESSAGE = "Automatic tests must not make network calls"
_NETWORK_GUARD_ACTIVE = False
_BLOCKED_PROGRAMS = {
    "aria2c",
    "curl",
    "ftp",
    "nc",
    "ping",
    "rsync",
    "scp",
    "sftp",
    "ssh",
    "telnet",
    "wget",
}
_BLOCKED_GIT_SUBCOMMANDS = {"clone", "fetch", "ls-remote", "pull", "push"}


def _blocked_create_connection(*args: Any, **kwargs: Any) -> socket.socket:
    raise RuntimeError(_GUARD_MESSAGE)


def _blocked_socket_connect(self: socket.socket, address: object) -> None:
    del self, address
    raise RuntimeError(_GUARD_MESSAGE)


def _blocked_socket_connect_ex(self: socket.socket, address: object) -> int:
    del self, address
    raise RuntimeError(_GUARD_MESSAGE)


def _extract_subprocess_argv(args: Any) -> list[str]:
    if isinstance(args, list | tuple):
        return [str(part) for part in args if str(part)]
    if isinstance(args, str):
        return [args]
    return []


def _assert_subprocess_command_allowed(args: Any) -> None:
    argv = _extract_subprocess_argv(args)
    if not argv:
        return

    program = Path(argv[0]).name
    resolved_program = shutil.which(argv[0])
    allowlisted_paths = {
        path
        for path in os.environ.get("ISOCHRONE_TESTS_ALLOW_SUBPROCESS_PATHS", "").split(os.pathsep)
        if path
    }
    if resolved_program in allowlisted_paths:
        return

    if program in _BLOCKED_PROGRAMS:
        raise RuntimeError(f"{_GUARD_MESSAGE}: subprocess {program}")
    if program == "git" and len(argv) > 1 and argv[1] in _BLOCKED_GIT_SUBCOMMANDS:
        raise RuntimeError(f"{_GUARD_MESSAGE}: subprocess git {argv[1]}")


class _GuardedPopen(subprocess.Popen[Any]):
    def __init__(self, args: Any, *popen_args: Any, **popen_kwargs: Any) -> None:
        _assert_subprocess_command_allowed(args)
        super().__init__(args, *popen_args, **popen_kwargs)


def install_network_guard() -> None:
    global _NETWORK_GUARD_ACTIVE
    if _NETWORK_GUARD_ACTIVE:
        return

    socket.create_connection = _blocked_create_connection  # type: ignore[assignment]
    socket.socket.connect = _blocked_socket_connect  # type: ignore[assignment]
    socket.socket.connect_ex = _blocked_socket_connect_ex  # type: ignore[assignment]
    subprocess.Popen = _GuardedPopen  # type: ignore[assignment]
    os.environ["ISOCHRONE_TESTS_NETWORK_GUARD_ACTIVE"] = "1"
    _NETWORK_GUARD_ACTIVE = True
