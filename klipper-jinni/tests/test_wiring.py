"""The wiring facet (ADR-0037): the jinni symlinks placed files into the system, preserves any stock
original so teardown restores the firmware exactly, and records each reversion as data.

The daemon resolves where a file belongs; creating, backing up, and removing the device symlink is
the jinni's actuation. These guard the stock-original backup/restore contract and the declarative
reversion record the off-host escape hatch replays.
"""
import errno
import json
from pathlib import Path

from jinni import stale_dentry
from jinni.wiring import Wiring


def _wire(plugin_dir: Path, source: Path, destination: Path) -> list:
    link = {"source": str(source), "destination": str(destination)}
    return Wiring().wire(str(plugin_dir), [link])


def test_wire_backs_up_a_stock_original_and_unwire_restores_it(tmp_path: Path) -> None:
    plugin_dir = tmp_path / "plugin"
    source = plugin_dir / "files" / "new.cfg"
    source.parent.mkdir(parents=True)
    source.write_text("plugin version\n")
    destination = tmp_path / "etc" / "thing.cfg"
    destination.parent.mkdir()
    destination.write_text("stock version\n")

    outcomes = _wire(plugin_dir, source, destination)

    assert outcomes[0].ok
    assert destination.is_symlink()
    assert destination.read_text() == "plugin version\n"

    Wiring().unwire(str(plugin_dir), [str(destination)])
    assert not destination.is_symlink()
    assert destination.read_text() == "stock version\n"


def test_wire_over_an_existing_symlink_does_not_capture_it_as_a_backup(tmp_path: Path) -> None:
    plugin_dir = tmp_path / "plugin"
    plugin_dir.mkdir()
    source = tmp_path / "source"
    source.write_text("ours\n")
    destination = tmp_path / "link"
    destination.symlink_to(tmp_path / "elsewhere")

    _wire(plugin_dir, source, destination)

    backup_dir = plugin_dir / "symlink_orig"
    assert not backup_dir.exists() or not any(backup_dir.iterdir())


def test_wire_records_a_replayable_reversion(tmp_path: Path) -> None:
    plugin_dir = tmp_path / "plugin"
    source = plugin_dir / "src.py"
    source.parent.mkdir(parents=True)
    source.write_text("x = 1\n")
    destination = tmp_path / "extras" / "src.py"

    _wire(plugin_dir, source, destination)

    record = json.loads((plugin_dir / "wiring.json").read_text())
    assert record["reversions"] == [{"action": "unlink", "path": str(destination)}]


def test_re_wiring_a_directory_does_not_create_a_nested_self_link(tmp_path: Path) -> None:
    """A directory placed by symlink (spoolman's spoolman_support_macros) must wire idempotently.
    The shell `ln -sf` an older install used dereferenced an existing directory symlink and wrote a
    self-link INSIDE the target (target/target -> target), a cycle Moonraker's file_manager tripped
    on ("Inotify watch already exists ... roots overlap"). Wiring clears the old symlink first, so a
    reinstall leaves exactly one link and the target stays clean."""
    plugin_dir = tmp_path / "plugin"
    macros = plugin_dir / "files" / "spoolman_support_macros"
    macros.mkdir(parents=True)
    (macros / "base_tools.cfg").write_text("x")
    destination = tmp_path / "config" / "bespok3d" / "klipper" / "spoolman_support_macros"

    _wire(plugin_dir, macros, destination)
    outcomes = _wire(plugin_dir, macros, destination)

    assert outcomes[0].ok
    assert destination.is_symlink()
    assert destination.resolve() == macros.resolve()
    assert [child.name for child in macros.iterdir()] == ["base_tools.cfg"]


def test_a_second_wire_accumulates_into_the_record(tmp_path: Path) -> None:
    plugin_dir = tmp_path / "plugin"
    plugin_dir.mkdir()
    first_src, second_src = tmp_path / "a", tmp_path / "b"
    first_src.write_text("a")
    second_src.write_text("b")
    first_dest, second_dest = tmp_path / "da", tmp_path / "db"

    _wire(plugin_dir, first_src, first_dest)
    _wire(plugin_dir, second_src, second_dest)

    record = json.loads((plugin_dir / "wiring.json").read_text())
    paths = {reversion["path"] for reversion in record["reversions"]}
    assert paths == {str(first_dest), str(second_dest)}


def _wedge_destination_once(monkeypatch, drops: list[str]) -> None:
    """Stand in for an orphaned overlay name: the first symlink attempt fails the way the kernel
    fails one (ESTALE), and it stops failing once the dentry cache has been dropped."""
    stock_symlink_to = Path.symlink_to

    def symlink_to(self: Path, target, target_is_directory: bool = False) -> None:  # noqa: ANN001
        if not drops:
            raise OSError(errno.ESTALE, "Stale file handle", str(self))
        stock_symlink_to(self, target, target_is_directory)

    monkeypatch.setattr(Path, "symlink_to", symlink_to)
    monkeypatch.setattr(stale_dentry, "drop_dentry_cache", lambda: drops.append("dropped"))


def test_wire_recovers_from_a_destination_wedged_by_a_stale_overlay_name(tmp_path: Path, monkeypatch) -> None:  # noqa: ANN001, E501
    plugin_dir = tmp_path / "plugin"
    source = plugin_dir / "files" / "apprise"
    source.parent.mkdir(parents=True)
    source.mkdir()
    destination = tmp_path / "site-packages" / "apprise"
    drops: list[str] = []
    _wedge_destination_once(monkeypatch, drops)

    outcomes = _wire(plugin_dir, source, destination)

    assert drops == ["dropped"]
    assert outcomes[0].ok, outcomes[0].output
    assert destination.is_symlink()


def test_wire_does_not_drop_the_dentry_cache_for_an_ordinary_failure(tmp_path: Path, monkeypatch) -> None:  # noqa: ANN001, E501
    plugin_dir = tmp_path / "plugin"
    plugin_dir.mkdir()
    source = tmp_path / "thing.cfg"
    source.write_text("x")
    drops: list[str] = []
    monkeypatch.setattr(stale_dentry, "drop_dentry_cache", lambda: drops.append("dropped"))

    def refuse(self: Path, target, target_is_directory: bool = False) -> None:  # noqa: ANN001
        raise OSError(errno.EACCES, "Permission denied", str(self))

    monkeypatch.setattr(Path, "symlink_to", refuse)

    outcomes = _wire(plugin_dir, source, tmp_path / "dest.cfg")

    assert drops == []
    assert not outcomes[0].ok
