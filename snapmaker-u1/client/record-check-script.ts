// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// The Python the venv's own interpreter runs on the printer to judge the venv. It prints one line per
// installed package, "installed", its state, the fingerprint of its RECORD and its dist-info dir, then
// one line per wheel file named on its command line, "wheel", the fingerprint of the RECORD inside that
// wheel and its path. A "-" stands for a fingerprint there is none of. Fields are tab-separated.
//
// The state: rows under __pycache__ are skipped, because pip compiles every installed .py there,
// overwriting any cached .pyc the wheel shipped, so a shipped row's hash is stale on a whole package and
// pip's own rows carry none. A RECORD left with no digest at all judges nothing, so it counts as
// unreadable.
//
// The fingerprint tells which wheel a package was installed from, so a wheel rebuilt at the same version
// is told apart. pip copies each digest of the wheel's own RECORD into the RECORD it installs, at the
// path the file landed on, then adds rows of its own. Both sides are reduced to the rows they share: a
// file that landed in site-packages and carries a digest, minus the bytecode pip compiles over and the
// dist-info files pip writes itself. The scripts, headers and data a wheel sends outside site-packages
// land on a path that starts with "..", and pip rewrites the scripts, so those are left out on both sides.
// The embedded Python holds no single quote, as the whole script travels on the command line in one.
export const RECORD_CHECK_SCRIPT = `
import base64, csv, glob, hashlib, io, os, posixpath, sys, sysconfig, zipfile, zlib

GENERATED_ON_INSTALL = ("INSTALLER", "REQUESTED", "direct_url.json")
SITE_PACKAGES_SCHEMES = ("purelib", "platlib")
WHEEL_READ_ERRORS = (OSError, EOFError, ValueError, RuntimeError, zipfile.BadZipFile, zlib.error, csv.Error)

def file_holds(site_dir, record_row):
    if "__pycache__" in record_row[0].split("/"):
        return True
    try:
        algorithm, recorded_digest = record_row[1].split("=", 1)
        with open(os.path.join(site_dir, record_row[0]), "rb") as installed_file:
            installed_digest = hashlib.new(algorithm, installed_file.read()).digest()
    except (OSError, ValueError, TypeError):
        return False
    return base64.urlsafe_b64encode(installed_digest).rstrip(b"=").decode() == recorded_digest.rstrip("=")

def dist_state(site_dir, record_rows):
    digested_rows = [record_row for record_row in record_rows if len(record_row) > 1 and record_row[1]]
    if not digested_rows:
        return "unrecorded"
    return "intact" if all(file_holds(site_dir, record_row) for record_row in digested_rows) else "damaged"

def judged_row(record_row):
    if len(record_row) < 2 or not record_row[1]:
        return None
    path_parts = posixpath.normpath(record_row[0]).split("/")
    if path_parts[0] == ".." or "__pycache__" in path_parts:
        return None
    if len(path_parts) == 2 and path_parts[0].endswith(".dist-info") and path_parts[1] in GENERATED_ON_INSTALL:
        return None
    return ("/".join(path_parts), record_row[1])

def record_fingerprint(record_rows):
    judged_rows = sorted({judged for judged in map(judged_row, record_rows) if judged})
    if not judged_rows:
        return "-"
    return hashlib.sha256(repr(judged_rows).encode()).hexdigest()

def installed_line(site_dir, dist_info):
    try:
        with open(os.path.join(dist_info, "RECORD"), newline="", encoding="utf-8") as record_file:
            record_rows = list(csv.reader(record_file))
    except (OSError, UnicodeDecodeError, csv.Error):
        record_rows = []
    state = dist_state(site_dir, record_rows)
    fingerprint = "-" if state == "unrecorded" else record_fingerprint(record_rows)
    return "\\t".join(("installed", state, fingerprint, dist_info))

def site_packages_row(wheel_row):
    path_parts = posixpath.normpath(wheel_row[0]).split("/")
    if not path_parts[0].endswith(".data"):
        return wheel_row
    if len(path_parts) > 2 and path_parts[1] in SITE_PACKAGES_SCHEMES:
        return ["/".join(path_parts[2:])] + wheel_row[1:]
    return None

def wheel_record_rows(wheel_file):
    with zipfile.ZipFile(wheel_file) as wheel_zip:
        record_names = [name for name in wheel_zip.namelist() if name.count("/") == 1 and name.endswith(".dist-info/RECORD")]
        record_text = wheel_zip.read(record_names[0]).decode("utf-8") if len(record_names) == 1 else ""
    return [record_row for record_row in csv.reader(io.StringIO(record_text, newline="")) if record_row]

def wheel_fingerprint(wheel_file):
    try:
        wheel_rows = wheel_record_rows(wheel_file)
    except WHEEL_READ_ERRORS:
        return "-"
    return record_fingerprint([installed_row for installed_row in map(site_packages_row, wheel_rows) if installed_row])

site_dirs = sorted({os.path.realpath(sysconfig.get_path(scheme_key)) for scheme_key in SITE_PACKAGES_SCHEMES})
for site_dir in site_dirs:
    for dist_info in sorted(glob.glob(os.path.join(site_dir, "*.dist-info"))):
        print(installed_line(site_dir, dist_info))
for wheel_file in sys.argv[1:]:
    print("wheel", wheel_fingerprint(wheel_file), wheel_file, sep="\\t")
`
