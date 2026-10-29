#!/usr/bin/env python3
"""Verify catalogue metadata and the local corpus files."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    repo_root = Path(__file__).resolve().parents[1]
    parser.add_argument(
        "--catalogue",
        type=Path,
        default=repo_root / "data" / "metadata" / "corpora.json",
    )
    parser.add_argument(
        "--corpora-dir",
        type=Path,
        default=repo_root / "data" / "corpora",
    )
    args = parser.parse_args()

    catalogue = json.loads(args.catalogue.read_text(encoding="utf-8"))
    failed = False
    for corpus in catalogue["corpora"]:
        path = args.corpora_dir / corpus["file"]
        if not path.exists():
            print(f"FAIL {corpus['id']}: missing {path}")
            failed = True
            continue
        if path.stat().st_size != corpus["bytes"]:
            print(f"FAIL {corpus['id']}: size mismatch")
            failed = True
            continue
        if sha256(path) != corpus["sha256"]:
            print(f"FAIL {corpus['id']}: checksum mismatch")
            failed = True
            continue
        connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        try:
            words = connection.execute("SELECT count(*) FROM word_objects").fetchone()[0]
            verses = connection.execute("SELECT count(*) FROM verse_objects").fetchone()[0]
        finally:
            connection.close()
        print(
            f"OK   {corpus['id']}: {len(corpus['books'])} books, "
            f"{verses:,} verses, {words:,} words"
        )
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
