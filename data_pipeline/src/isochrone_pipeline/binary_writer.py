"""Binary writing utilities for deterministic graph serialization."""

from __future__ import annotations

import struct


class BinaryWriter:
    """Little-endian binary writer backed by a mutable bytearray."""

    def __init__(self) -> None:
        self._buffer = bytearray()

    @property
    def offset(self) -> int:
        return len(self._buffer)

    def write_u8(self, value: int) -> None:
        self._buffer.extend(struct.pack("<B", value))

    def write_u16(self, value: int) -> None:
        self._buffer.extend(struct.pack("<H", value))

    def write_u32(self, value: int) -> None:
        self._buffer.extend(struct.pack("<I", value))

    def write_i32(self, value: int) -> None:
        self._buffer.extend(struct.pack("<i", value))

    def write_f32(self, value: float) -> None:
        self._buffer.extend(struct.pack("<f", value))

    def write_f64(self, value: float) -> None:
        self._buffer.extend(struct.pack("<d", value))

    def pad_to(self, alignment: int) -> None:
        if alignment <= 0:
            raise ValueError("alignment must be positive")

        remainder = self.offset % alignment
        if remainder == 0:
            return

        pad_count = alignment - remainder
        self._buffer.extend(b"\x00" * pad_count)

    def to_bytes(self) -> bytes:
        return bytes(self._buffer)
