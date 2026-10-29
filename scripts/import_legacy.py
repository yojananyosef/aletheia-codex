#!/usr/bin/env python3
"""Build the normalized corpus catalogue from the legacy BibleOL data.

The legacy project remains the source of truth for dbinfo/typeinfo/bookorder and
the Emdros files. This script writes a small, stable JSON document consumed by
the web application. It does not copy corpus files.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
from pathlib import Path

CORPORA = {
    "ETCBC4": {
        "title": "Biblia hebrea",
        "language": "he",
        "language_name": "Hebreo",
        "direction": "rtl",
    },
    "nestle1904": {
        "title": "Nuevo Testamento griego",
        "language": "grc",
        "language_name": "Griego",
        "direction": "ltr",
    },
    "jvulgate": {
        "title": "Vulgata latina",
        "language": "la",
        "language_name": "Latín",
        "direction": "ltr",
    },
}

# Curated word features for reading. Keys are Emdros feature names.
FEATURES = {
    "ETCBC4": [
        ("sp", "Categoría", "enum", "part_of_speech_t"),
        ("vs", "Tallo verbal", "enum", "verbal_stem_t"),
        ("vt", "Tiempo verbal", "enum", "verbal_tense_t"),
        ("st", "Estado", "enum", "state_t"),
        ("ps", "Persona", "enum", "person_t"),
        ("gn", "Género", "enum", "gender_t"),
        ("nu", "Número", "enum", "number_t"),
        ("language", "Idioma", "enum", "language_t"),
    ],
    "nestle1904": [
        ("psp", "Categoría", "enum", "psp_t"),
        ("tense", "Tiempo", "enum", "tense_t"),
        ("voice", "Voz", "enum", "voice_t"),
        ("mood", "Modo", "enum", "mood_t"),
        ("case", "Caso", "enum", "case_t"),
        ("number", "Número", "enum", "number_t"),
        ("gender", "Género", "enum", "gender_t"),
        ("person", "Persona", "enum", "person_t"),
    ],
    "jvulgate": [
        ("psp", "Categoría", "enum", "psp_t"),
        ("case", "Caso", "enum", "case_t"),
        ("number", "Número", "enum", "number_t"),
        ("gender", "Género", "enum", "gender_t"),
        ("person", "Persona", "enum", "person_t"),
        ("tense", "Tiempo", "enum", "tense_t"),
        ("voice", "Voz", "enum", "voice_t"),
        ("mood", "Modo", "enum", "mood_t"),
        ("degree", "Grado", "enum", "degree_t"),
        ("declension", "Declinación", "enum", "declension_t"),
        ("conjugation", "Conjugación", "enum", "conjugation_t"),
        ("stem", "Raíz", "enum", "stem_t"),
    ],
}

LEMMA_FEATURES = {
    "ETCBC4": "g_voc_lex_utf8",
    "nestle1904": "lemma",
    "jvulgate": "lemma",
}

TRANSLITERATION_FEATURES = {
    "ETCBC4": "g_word_translit",
    "nestle1904": None,
    "jvulgate": None,
}


def read_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def table_exists(connection: sqlite3.Connection, table: str) -> bool:
    row = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)
    ).fetchone()
    return row is not None


def enum_values(connection: sqlite3.Connection, enum_name: str) -> dict[str, str]:
    row = connection.execute(
        "SELECT enum_id FROM enumerations WHERE enum_name = ?", (enum_name,)
    ).fetchone()
    if row is None:
        return {}

    values = connection.execute(
        "SELECT value, enum_value_name FROM enumeration_constants "
        "WHERE enum_id = ? ORDER BY value",
        (row[0],),
    ).fetchall()
    return {str(value): name for value, name in values}


def parse_bookorder(path: Path) -> list[dict]:
    books: list[dict] = []
    for index, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw_line.strip()
        if not line:
            continue
        name, _, chapter_range = line.rpartition("/")
        if not name:
            raise ValueError(f"Invalid bookorder line: {raw_line!r}")
        start, separator, end = chapter_range.partition("-")
        first = int(start)
        last = int(end) if separator else first
        if first != 1 or last < first:
            raise ValueError(f"Unsupported chapter range: {raw_line!r}")
        books.append(
            {
                "id": name,
                "name": name,
                "number": index,
                "chapters": last,
            }
        )
    return books


def find_corpus_file(corpora_dir: Path, corpus_id: str) -> Path:
    matches = sorted(corpora_dir.glob(f"{corpus_id}.v*"))
    if not matches:
        raise FileNotFoundError(
            f"Missing {corpus_id} corpus in {corpora_dir}. Run scripts/sync_corpora.py first."
        )
    return matches[0]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_corpus(
    legacy_dir: Path, corpora_dir: Path, corpus_id: str, config: dict
) -> dict:
    db_path = legacy_dir / "db"
    info = read_json(db_path / f"{corpus_id}.db.pretty.json")
    typeinfo = read_json(db_path / f"{corpus_id}.typeinfo.pretty.json")
    corpus_file = find_corpus_file(corpora_dir, corpus_id)
    location_file = db_path / f"{corpus_id}.location"
    source = location_file.read_text(encoding="utf-8").strip() if location_file.exists() else None

    connection = sqlite3.connect(f"file:{corpus_file}?mode=ro", uri=True)
    try:
        surface_feature = info["surfaceFeature"]
        lemma_feature = LEMMA_FEATURES[corpus_id]
        transliteration_feature = TRANSLITERATION_FEATURES[corpus_id]

        surface_table = f"word_mdf_{surface_feature}_set"
        lemma_table = f"word_mdf_{lemma_feature}_set"
        transliteration_table = (
            f"word_mdf_{transliteration_feature}_set"
            if transliteration_feature
            else None
        )
        for table in (surface_table, lemma_table):
            if not table_exists(connection, table):
                raise RuntimeError(f"{corpus_id}: missing table {table}")
        if transliteration_table and not table_exists(connection, transliteration_table):
            transliteration_feature = None
            transliteration_table = None

        features = []
        for key, label, kind, enum_name in FEATURES[corpus_id]:
            if kind == "enum":
                values = enum_values(connection, enum_name)
                if not values:
                    raise RuntimeError(
                        f"{corpus_id}: missing enum {enum_name} for feature {key}"
                    )
                features.append(
                    {
                        "key": key,
                        "label": label,
                        "kind": "enum",
                        "enum": enum_name,
                        "values": values,
                    }
                )
            else:
                table = f"word_mdf_{key}_set"
                if not table_exists(connection, table):
                    raise RuntimeError(f"{corpus_id}: missing table {table}")
                features.append(
                    {"key": key, "label": label, "kind": "string", "table": table}
                )

        books = parse_bookorder(db_path / f"{corpus_id}.bookorder")
        return {
            "id": corpus_id,
            "name": info["databaseName"],
            "title": config["title"],
            "version": info.get("databaseVersion"),
            "language": config["language"],
            "languageName": config["language_name"],
            "direction": config["direction"],
            "charset": info.get("charSet"),
            "file": corpus_file.name,
            "bytes": corpus_file.stat().st_size,
            "sha256": sha256(corpus_file),
            "source": source,
            "surface": {"key": surface_feature, "table": surface_table},
            "lemma": {"key": lemma_feature, "table": lemma_table},
            "transliteration": (
                {
                    "key": transliteration_feature,
                    "table": transliteration_table,
                }
                if transliteration_feature
                else None
            ),
            "features": features,
            "books": books,
        }
    finally:
        connection.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    repo_root = Path(__file__).resolve().parents[1]
    parser.add_argument(
        "--legacy",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "BibleOL",
        help="Path to the legacy BibleOL repository",
    )
    parser.add_argument(
        "--corpora-dir",
        type=Path,
        default=repo_root / "data" / "corpora",
        help="Directory containing Emdros corpus files",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=repo_root / "data" / "metadata" / "corpora.json",
        help="Output catalogue path",
    )
    args = parser.parse_args()

    if not args.legacy.exists():
        parser.error(f"Legacy repository not found: {args.legacy}")
    if not args.corpora_dir.exists():
        parser.error(f"Corpora directory not found: {args.corpora_dir}")

    catalogue = {
        "version": 1,
        "generatedFrom": args.legacy.resolve().name,
        "corpora": [
            build_corpus(args.legacy, args.corpora_dir, corpus_id, config)
            for corpus_id, config in CORPORA.items()
        ],
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(catalogue, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Wrote {args.out} ({len(catalogue['corpora'])} corpora)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
