import sys
from pathlib import Path

JINNI_DIR = Path(__file__).resolve().parent.parent
# The jinni imports the generic daemon's `jinni` package. The daemon still lives in the Bespok3d
# repo (a sibling at the workspace root now that adapters/ moved out); resolve it from there.
DAEMON_DIR = JINNI_DIR.parent.parent.parent / "Bespok3d" / "src" / "daemon"

sys.path.insert(0, str(DAEMON_DIR))
sys.path.insert(0, str(JINNI_DIR))
