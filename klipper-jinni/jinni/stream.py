"""The blocked-action subscribe stream the jinni serves to the daemon (ADR-0037).

One subscription per client: push the blocked-action token set on change. Distinct from the one-shot
verb dispatch in `service.py` because of its lifecycle: it is long-lived and awaits the device
(Klipper's next state) between pushes, so its teardown is the subtle part. We race the push against
the connection closing and CANCEL the stream task on disconnect, so the cancellation unwinds the
watch generator through its own `finally` (closing the Klipper socket). An external aclose instead
would race the generator mid-await ("asynchronous generator is already running") and crash the loop.
"""
import asyncio
import contextlib
from typing import Any

from protocol import result_bytes


async def _push_changes(writer: asyncio.StreamWriter, jinni: Any) -> None:
    try:
        async for blocked in jinni.watch_blocked_actions():
            writer.write(result_bytes(sorted(blocked)))
            await writer.drain()
    except (ConnectionResetError, BrokenPipeError):
        pass


async def _await_disconnect(reader: asyncio.StreamReader) -> None:
    """Resolve when the daemon closes the subscribe connection (it sends nothing after the request,
    so a read returns at EOF)."""
    with contextlib.suppress(OSError):
        await reader.read()


async def serve_stream(reader: asyncio.StreamReader, writer: asyncio.StreamWriter, jinni: Any) -> None:  # noqa: E501
    """Stream blocked-action changes until the daemon disconnects, racing the push against the
    connection closing. Whichever finishes first, both tasks are cancelled and awaited so the watch
    generator unwinds cleanly: without this the handler would sit awaiting Klipper on a half-dead
    connection until the next state change, then be torn down mid-await and crash the loop."""
    push = asyncio.create_task(_push_changes(writer, jinni))
    disconnect = asyncio.create_task(_await_disconnect(reader))
    try:
        await asyncio.wait({push, disconnect}, return_when=asyncio.FIRST_COMPLETED)
    finally:
        push.cancel()
        disconnect.cancel()
        await asyncio.gather(push, disconnect, return_exceptions=True)
