import struct

import pytest
from isochrone_pipeline.binary_writer import BinaryWriter


def test_writes_expected_binary_layout() -> None:
    writer = BinaryWriter()

    writer.write_u8(0x12)
    writer.write_u16(0x3456)
    writer.write_u32(0x789ABCDE)
    writer.write_i32(-123456)
    writer.write_f32(10.5)
    writer.write_f64(20.25)

    payload = writer.to_bytes()

    assert payload[:1] == b"\x12"
    assert payload[1:3] == struct.pack("<H", 0x3456)
    assert payload[3:7] == struct.pack("<I", 0x789ABCDE)
    assert payload[7:11] == struct.pack("<i", -123456)
    assert payload[11:15] == struct.pack("<f", 10.5)
    assert payload[15:23] == struct.pack("<d", 20.25)


def test_pad_to_alignment_with_zero_bytes() -> None:
    writer = BinaryWriter()

    writer.write_u8(1)
    writer.pad_to(8)

    payload = writer.to_bytes()

    assert len(payload) == 8
    assert payload == b"\x01" + (b"\x00" * 7)


@pytest.mark.parametrize("alignment", [0, -1])
def test_pad_to_rejects_invalid_alignment(alignment: int) -> None:
    writer = BinaryWriter()

    with pytest.raises(ValueError):
        writer.pad_to(alignment)
