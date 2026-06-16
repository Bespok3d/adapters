import sys
from pathlib import Path

JINNI_DIR = Path(__file__).resolve().parent.parent  # this adapter's device jinni (bespok3d_jinni)
ADAPTERS_DIR = JINNI_DIR.parent.parent  # the org's adapters/ tree
# The device jinni extends the shared klipper jinni runtime (the `jinni` package, in the sibling
# klipper-jinni app) and speaks the daemon's `protocol` package. Two separate apps; resolve both.
KLIPPER_JINNI_DIR = ADAPTERS_DIR / "klipper-jinni"
DAEMON_DIR = ADAPTERS_DIR.parent / "daemon"

sys.path.insert(0, str(DAEMON_DIR))
sys.path.insert(0, str(KLIPPER_JINNI_DIR))
sys.path.insert(0, str(JINNI_DIR))
