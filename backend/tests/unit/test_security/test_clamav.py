"""The clamd INSTREAM client (R5 AC3).

A fake clamd on a loopback port records the bytes the client sends and replies
the way clamd does, so the framing and every verdict are checked without
ClamAV. Scanning fails closed: anything other than a clear OK or FOUND raises,
so a CV is never marked clean because the scanner could not answer.
"""

from __future__ import annotations

import asyncio
import struct
from typing import TYPE_CHECKING

import pytest

from app.platform.errors.base import UpstreamUnavailable
from app.platform.security.clamav import ScanVerdict, scan_bytes

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Callable

pytestmark = [pytest.mark.unit, pytest.mark.security]


class _FakeClamd:
    def __init__(self, reply: Callable[[bytes], bytes]) -> None:
        self._reply = reply
        self.received: list[bytes] = []
        self.port = 0
        self._server: asyncio.Server | None = None

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        command = await reader.readuntil(b"\0")
        payload = b""
        while True:
            (size,) = struct.unpack(">I", await reader.readexactly(4))
            if size == 0:
                break
            payload += await reader.readexactly(size)
        self.received.append(command + payload)
        writer.write(self._reply(payload))
        await writer.drain()
        writer.close()

    async def __aenter__(self) -> _FakeClamd:
        self._server = await asyncio.start_server(self._handle, "127.0.0.1", 0)
        self.port = self._server.sockets[0].getsockname()[1]
        return self

    async def __aexit__(self, *exc: object) -> None:
        assert self._server is not None
        self._server.close()
        await self._server.wait_closed()


@pytest.fixture
async def clean_clamd() -> AsyncIterator[_FakeClamd]:
    async with _FakeClamd(lambda _payload: b"stream: OK\0") as server:
        yield server


async def test_a_clean_file_is_streamed_in_frames_and_reported_clean(
    clean_clamd: _FakeClamd,
) -> None:
    data = bytes(range(256)) * 1000  # 256 KB, more than one chunk

    verdict = await scan_bytes(data, host="127.0.0.1", port=clean_clamd.port, chunk_bytes=64 * 1024)

    assert verdict == ScanVerdict(clean=True, signature=None)
    # The z-prefixed command, then the file reassembled exactly from its frames.
    assert clean_clamd.received == [b"zINSTREAM\0" + data]


async def test_an_infected_file_reports_its_signature() -> None:
    async with _FakeClamd(lambda _payload: b"stream: Eicar-Test-Signature FOUND\0") as server:
        verdict = await scan_bytes(b"X5O!P%@AP", host="127.0.0.1", port=server.port)

    assert verdict == ScanVerdict(clean=False, signature="Eicar-Test-Signature")


async def test_a_clamd_error_reply_fails_closed() -> None:
    async with _FakeClamd(lambda _payload: b"INSTREAM size limit exceeded. ERROR\0") as server:
        with pytest.raises(UpstreamUnavailable):
            await scan_bytes(b"data", host="127.0.0.1", port=server.port)


async def test_an_unreachable_clamd_fails_closed() -> None:
    # Bind then release a port, so nothing is listening on it.
    server = await asyncio.start_server(lambda _r, _w: None, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    server.close()
    await server.wait_closed()

    with pytest.raises(UpstreamUnavailable):
        await scan_bytes(b"data", host="127.0.0.1", port=port)
