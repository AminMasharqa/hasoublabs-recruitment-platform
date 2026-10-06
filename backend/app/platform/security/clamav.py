"""ClamAV client over clamd's INSTREAM protocol (R5 AC3).

The CV scan worker sends each uploaded file here before the version may become
Available. The protocol is small enough to speak directly on asyncio streams, so
there is no client dependency and nothing blocks the event loop:

* send ``zINSTREAM\\0``;
* send the file as frames, each a 4-byte big-endian length then that many bytes;
* end with a zero-length frame;
* read one NUL-terminated reply: ``stream: OK`` or ``stream: <signature> FOUND``.

Scanning **fails closed**. An unreachable clamd, a timeout, or any reply other
than OK or FOUND raises :class:`UpstreamUnavailable`, so the scan job retries and
then dead-letters, and the version stays PendingScan. A CV is never marked clean
because the scanner could not answer.
"""

from __future__ import annotations

import asyncio
import contextlib
from dataclasses import dataclass
import struct
from typing import Final

from app.platform.errors.base import UpstreamUnavailable

__all__ = ["ScanVerdict", "scan_bytes"]

#: Frame size sent to clamd. Well under clamd's default StreamMaxLength.
DEFAULT_CHUNK_BYTES: Final[int] = 64 * 1024

_SERVICE: Final[str] = "clamav"
_FOUND_SUFFIX: Final[str] = " FOUND"
_STREAM_PREFIX: Final[str] = "stream: "


@dataclass(frozen=True)
class ScanVerdict:
    """What clamd concluded about one file."""

    clean: bool
    #: The matched signature name when the file is infected, otherwise ``None``.
    signature: str | None


async def scan_bytes(
    data: bytes,
    *,
    host: str,
    port: int,
    timeout_seconds: float = 60.0,
    chunk_bytes: int = DEFAULT_CHUNK_BYTES,
) -> ScanVerdict:
    """Scan ``data`` with the clamd at ``host:port``.

    Raises:
        UpstreamUnavailable: If clamd cannot be reached, does not answer within
            ``timeout_seconds``, or answers with anything but OK or FOUND.
    """
    try:
        reply = await asyncio.wait_for(
            _instream(data, host=host, port=port, chunk_bytes=chunk_bytes),
            timeout=timeout_seconds,
        )
    except (OSError, TimeoutError, asyncio.IncompleteReadError) as exc:
        raise UpstreamUnavailable(
            service=_SERVICE,
            log_message=f"clamd at {host}:{port} did not answer: {exc!r}",
        ) from exc
    return _verdict(reply, host=host, port=port)


async def _instream(data: bytes, *, host: str, port: int, chunk_bytes: int) -> str:
    reader, writer = await asyncio.open_connection(host, port)
    try:
        writer.write(b"zINSTREAM\0")
        for offset in range(0, len(data), chunk_bytes):
            chunk = data[offset : offset + chunk_bytes]
            writer.write(struct.pack(">I", len(chunk)) + chunk)
            await writer.drain()
        writer.write(struct.pack(">I", 0))
        await writer.drain()
        raw = await reader.readuntil(b"\0")
    finally:
        writer.close()
        with contextlib.suppress(OSError):
            await writer.wait_closed()
    return raw.rstrip(b"\0").decode("utf-8", errors="replace").strip()


def _verdict(reply: str, *, host: str, port: int) -> ScanVerdict:
    if reply.startswith(_STREAM_PREFIX):
        body = reply[len(_STREAM_PREFIX) :]
        if body == "OK":
            return ScanVerdict(clean=True, signature=None)
        if body.endswith(_FOUND_SUFFIX):
            return ScanVerdict(clean=False, signature=body[: -len(_FOUND_SUFFIX)].strip())
    raise UpstreamUnavailable(
        service=_SERVICE,
        log_message=f"clamd at {host}:{port} answered {reply!r}",
    )
