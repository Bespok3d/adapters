"""The device-file r/w facet (ADR-0037): the jinni reads a stock file for the daemon to patch
(fetch) and writes the patched / restored content back (write_files), recording the restore
reversion. fetch preserves the original bytes so the pristine baseline is a byte-exact restore.
"""
import json
from pathlib import Path

from jinni.device_files import DeviceFiles


def test_fetch_returns_content_preserving_line_endings(tmp_path: Path) -> None:
    target = tmp_path / "toolhead.py"
    target.write_bytes(b"a\r\nb\r\n")
    assert DeviceFiles().fetch(str(target)) == "a\r\nb\r\n"


def test_fetch_returns_none_for_a_missing_file(tmp_path: Path) -> None:
    assert DeviceFiles().fetch(str(tmp_path / "absent.py")) is None


def test_write_files_writes_content_and_records_a_restore_reversion(tmp_path: Path) -> None:
    plugin_dir = tmp_path / "plugin"
    plugin_dir.mkdir()
    pristine = plugin_dir / "patches_orig" / "toolhead.py"
    pristine.parent.mkdir(parents=True)
    pristine.write_text("stock\n")
    target = tmp_path / "klippy" / "toolhead.py"

    outcomes = DeviceFiles().write_files(str(plugin_dir), [
        {"path": str(target), "content": "patched\n", "restore_from": str(pristine)},
    ])

    assert outcomes[0].ok
    assert target.read_text() == "patched\n"
    record = json.loads((plugin_dir / "wiring.json").read_text())
    assert record["reversions"] == [
        {"action": "restore", "path": str(target), "backup": str(pristine)},
    ]


def test_write_files_without_restore_from_records_nothing(tmp_path: Path) -> None:
    plugin_dir = tmp_path / "plugin"
    plugin_dir.mkdir()
    target = tmp_path / "toolhead.py"

    DeviceFiles().write_files(str(plugin_dir), [{"path": str(target), "content": "stock\n"}])

    assert target.read_text() == "stock\n"
    assert not (plugin_dir / "wiring.json").exists()
