#!/usr/bin/env python3
"""Download the Emdros corpus files declared in the generated catalogue."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path


def download(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".part")
    request = urllib.request.Request(url, headers={"User-Agent": "AletheiaCodex/0.1"})
    with urllib.request.urlopen(request) as response, temporary.open("wb") as handle:
        while chunk := response.read(1024 * 1024):
            handle.write(chunk)
    temporary.replace(destination)


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
    parser.add_argument("--force", action="store_true", help="Download even when present")
    parser.add_argument("--corpus", help="Only sync this corpus id")
    args = parser.parse_args()

    if not args.catalogue.exists():
        parser.error(f"Catalogue not found: {args.catalogue}. Run scripts/import_legacy.py first.")
    catalogue = json.loads(args.catalogue.read_text(encoding="utf-8"))

    for corpus in catalogue["corpora"]:
        if args.corpus and corpus["id"] != args.corpus:
            continue
        destination = args.corpora_dir / corpus["file"]
        if destination.exists() and not args.force:
            print(f"{corpus['id']}: already present")
            continue
        source = corpus.get("source")
        if not source:
            print(f"{corpus['id']}: no source URL", file=sys.stderr)
            return 1
        parsed = urllib.parse.urlsplit(source)
        query = dict(urllib.parse.parse_qsl(parsed.query))
        if parsed.netloc.endswith("dropbox.com") and "dl" in query:
            query["dl"] = "1"
        url = urllib.parse.urlunsplit(parsed._replace(query=urllib.parse.urlencode(query)))
        print(f"{corpus['id']}: downloading {url}")
        download(url, destination)
        actual = sha256(destination)
        expected = corpus.get("sha256")
        if expected and actual != expected:
            print(
                f"{corpus['id']}: checksum mismatch\nexpected {expected}\nactual   {actual}",
                file=sys.stderr,
            )
            return 1
        print(f"{corpus['id']}: {destination} ({destination.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
