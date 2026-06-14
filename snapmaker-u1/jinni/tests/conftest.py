import sys
from pathlib import Path

JINNI_DIR = Path(__file__).resolve().parent.parent
# The jinni imports the generic daemon's `jinni` package. The daemon is its own repo, a sibling at
# the workspace root (the split out of Bespok3d/src/daemon); resolve it from there.
DAEMON_DIR = JINNI_DIR.parent.parent.parent / "daemon"

sys.path.insert(0, str(DAEMON_DIR))
sys.path.insert(0, str(JINNI_DIR))
