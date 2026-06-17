"""Wiring for the daemon-with-jinni together tests.

These exercise the two apps as a pair: the daemon's seam/supervisor driving a real klipper jinni
over the protocol. On the printer the daemon and the jinni co-locate in one deploy dir; in the split
dev layout they are separate dirs, so a spawned `python -m jinni` child needs both on its path.
Tests that drive the daemon's in-process seam inject a device-equipped klipper jinni.
"""
import os
from pathlib import Path

import pytest

from core import jinni_client
from jinni.klipper import KlipperPrinterJinni

_KLIPPER_JINNI_ROOT = Path(__file__).resolve().parents[2]
_DAEMON_ROOT = _KLIPPER_JINNI_ROOT.parent.parent / "daemon"

_RESTART_COMMANDS = {
    "klipper": "/etc/init.d/S60klipper restart",
    "moonraker": "/etc/init.d/S61moonraker restart",
    "web": "/usr/sbin/nginx -s reload",
    "lmd": "$BESPOK3D/etc/init.d/lmdctl restart",
}


class _DeviceJinni(KlipperPrinterJinni):
    """A device-equipped klipper jinni for the together tests: it resolves the klipper path contract
    and the restart hooks, the way a real adapter jinni does."""

    def device_paths(self) -> dict[str, str]:
        return {key: f"/dev/null/{key}" for key in KlipperPrinterJinni.KLIPPER_PATH_KEYS}

    def restart_command(self, hook: str) -> str | None:
        return _RESTART_COMMANDS.get(hook)


@pytest.fixture(autouse=True)
def subprocess_pythonpath(monkeypatch: pytest.MonkeyPatch) -> None:
    existing = os.environ.get("PYTHONPATH", "")
    parts = [str(_KLIPPER_JINNI_ROOT), str(_DAEMON_ROOT), existing]
    monkeypatch.setenv("PYTHONPATH", os.pathsep.join(part for part in parts if part))


@pytest.fixture(autouse=True)
def device_jinni(monkeypatch: pytest.MonkeyPatch) -> _DeviceJinni:
    jinni = _DeviceJinni()
    monkeypatch.setattr(jinni_client.dispatch, "get_jinni", lambda: jinni)
    return jinni
