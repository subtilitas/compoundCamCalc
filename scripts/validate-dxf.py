#!/usr/bin/env python3
"""Validates the DXF and ZIP files of a directory, the DXF files with ezdxf.

Usage: python3 scripts/validate-dxf.py <dir>

For every .dxf file in <dir> (not recursive) the script checks:
- ezdxf reads the file, the version is AC1015 and $INSUNITS is 4;
- doc.audit() reports no errors and applies no fixes;
- the raw text contains ACAD_LAYOUT, every BLOCK_RECORD has group 340 and
  the layouts ezdxf uses are the ones in the file;
- $HANDSEED is greater than every handle (groups 5 and 105);
- SPLINE entities: counts closed curves (first control point equals the
  last within 1e-9) and open curves;
- the file holds ASCII bytes only.

For every .zip file in <dir> it checks the CRC of every entry and that each
entry equals the single file of the same sample (<sample>-<entry name>).

Prints one summary line per file and exits with 1 when any check fails.
Requires ezdxf (see scripts/requirements.txt).
"""

import math
import pathlib
import sys
import zipfile

import ezdxf

CLOSED_TOLERANCE = 1e-9


def raw_pairs(path):
    """Group code/value pairs of the raw file; ValueError names a bad line."""
    lines = path.read_text(encoding="ascii", errors="replace").splitlines()
    pairs = []
    for i in range(0, len(lines) - 1, 2):
        try:
            code = int(lines[i].strip())
        except ValueError:
            raise ValueError(f"group code expected at line {i + 1}: {lines[i]!r}") from None
        pairs.append((code, lines[i + 1]))
    return pairs


def raw_items(pairs):
    """Items started by group 0, as (type, pairs) tuples."""
    items = []
    for code, value in pairs:
        if code == 0:
            items.append((value, []))
        elif items:
            items[-1][1].append((code, value))
    return items


def check_file(path):
    """Returns (errors, summary) for one file."""
    errors = []
    try:
        doc = ezdxf.readfile(str(path))
    except Exception as exc:  # noqa: BLE001 - any read failure is a finding
        return [f"ezdxf cannot read the file: {exc}"], "unreadable"

    if doc.dxfversion != "AC1015":
        errors.append(f"version {doc.dxfversion}, expected AC1015")
    insunits = doc.header.get("$INSUNITS")
    if insunits != 4:
        errors.append(f"$INSUNITS {insunits}, expected 4")

    auditor = doc.audit()
    for entry in auditor.errors:
        errors.append(f"audit error: {entry.message}")
    for entry in auditor.fixes:
        errors.append(f"audit fix: {entry.message}")

    if any(b > 0x7F for b in path.read_bytes()):
        errors.append("non-ASCII byte in the file")
    text = path.read_text(encoding="ascii", errors="replace")
    if "ACAD_LAYOUT" not in text:
        errors.append("no ACAD_LAYOUT dictionary")
    pairs = raw_pairs(path)
    items = raw_items(pairs)
    handles = set()
    for index, (code, value) in enumerate(pairs):
        if code in (5, 105) and not (index > 0 and pairs[index - 1] == (9, "$HANDSEED")):
            if value in handles:
                errors.append(f"duplicate handle {value}")
            handles.add(value)
    for kind, item in items:
        if kind == "BLOCK_RECORD" and not any(code == 340 for code, _ in item):
            name = next((v for c, v in item if c == 2), "?")
            errors.append(f"BLOCK_RECORD {name} without group 340")
    for layout in doc.layouts:
        handle = layout.dxf_layout.dxf.handle
        if handle not in handles:
            errors.append(f"layout {layout.name} created by ezdxf (handle {handle} not in the file)")

    seed_index = next((i for i, p in enumerate(pairs) if p == (9, "$HANDSEED")), None)
    if seed_index is None:
        errors.append("no $HANDSEED")
    else:
        seed = int(pairs[seed_index + 1][1], 16)
        largest = max((int(h, 16) for h in handles), default=0)
        if seed <= largest:
            errors.append(f"$HANDSEED {seed:X} not greater than the largest handle {largest:X}")

    closed = 0
    open_count = 0
    for spline in doc.modelspace().query("SPLINE"):
        points = spline.control_points
        if len(points) < 2:
            errors.append(f"SPLINE {spline.dxf.handle} with {len(points)} control points")
            continue
        first, last = points[0], points[-1]
        if math.dist(first, last) <= CLOSED_TOLERANCE:
            closed += 1
        else:
            open_count += 1

    entities = len(doc.modelspace())
    summary = (
        f"{entities} entities, {closed} closed and {open_count} open splines, "
        f"{len(doc.layers)} layers, {len(handles)} handles"
    )
    return errors, summary


def check_zip(path):
    """Returns (errors, summary) for one ZIP: CRC of every entry, and every
    entry equal to the single file of the same sample, named
    <sample>-<entry>."""
    errors = []
    try:
        with zipfile.ZipFile(path) as archive:
            bad = archive.testzip()
            if bad is not None:
                errors.append(f"CRC or header error in {bad}")
            names = archive.namelist()
            sample = path.name.split("-", 1)[0]
            for name in names:
                if name == "README.txt":
                    continue
                single = path.parent / f"{sample}-{name}"
                if not single.exists():
                    errors.append(f"{name}: no single file {single.name}")
                elif archive.read(name) != single.read_bytes():
                    errors.append(f"{name}: differs from {single.name}")
    except (zipfile.BadZipFile, OSError) as exc:
        return [f"cannot read the ZIP: {exc}"], "unreadable"
    return errors, f"{len(names)} entries"


def main(argv):
    if len(argv) != 2:
        print("usage: python3 scripts/validate-dxf.py <dir>", file=sys.stderr)
        return 2
    directory = pathlib.Path(argv[1])
    files = sorted(directory.glob("*.dxf"))
    if not files:
        print(f"no .dxf files in {directory}", file=sys.stderr)
        return 1
    failed = 0
    for path in files:
        try:
            errors, summary = check_file(path)
        except Exception as exc:  # noqa: BLE001 - one bad file must not stop the run
            errors, summary = [f"check crashed: {exc!r}"], "crashed"
        status = "FAIL" if errors else "ok"
        print(f"{status} {path.name}: {summary}")
        for message in errors:
            print(f"  {message}")
        failed += bool(errors)
    for path in sorted(directory.glob("*.zip")):
        errors, summary = check_zip(path)
        status = "FAIL" if errors else "ok"
        print(f"{status} {path.name}: {summary}")
        for message in errors:
            print(f"  {message}")
        failed += bool(errors)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
