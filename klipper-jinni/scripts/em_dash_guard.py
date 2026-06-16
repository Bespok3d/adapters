#!/usr/bin/env python3
"""RULE ZERO guard for the klipper-jinni app: fail on any em-dash (U+2014) or en-dash (U+2013).

Banned everywhere in Bespok3d; no linter enforces it. Walks this app's authored text by suffix,
skipping caches and build output. The dash codepoints are written as escapes so the guard never
trips on itself.
"""
import sys
from pathlib import Path

EM_DASH = chr(0x2014)
EN_DASH = chr(0x2013)
SCANNED_SUFFIXES = (".py", ".md", ".json", ".sh", ".toml", ".txt")
EXCLUDED_DIRS = (
    ".venv", ".git", "__pycache__", ".mypy_cache", ".pytest_cache", ".ruff_cache", ".hypothesis",
)


def is_scanned(path: Path) -> bool:
    if not path.is_file() or any(part in EXCLUDED_DIRS for part in path.parts):
        return False
    return path.suffix in SCANNED_SUFFIXES


def has_banned_dash(path: Path) -> bool:
    text = path.read_text(encoding="utf-8", errors="ignore")
    return EM_DASH in text or EN_DASH in text


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    offenders = [path for path in root.rglob("*") if is_scanned(path) and has_banned_dash(path)]
    for path in offenders:
        print(f"RULE ZERO violation (em-dash/en-dash): {path.relative_to(root)}")
    return 1 if offenders else 0


if __name__ == "__main__":
    sys.exit(main())
