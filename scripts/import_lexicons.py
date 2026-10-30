#!/usr/bin/env python3
"""Import the legacy BibleOL CSV lexicons into the local web data directory.

The generated files are small, stable JSON documents keyed by the same values
the Emdros corpora use (lexical code + stem, Strong's number, or lemma + part of
speech). They contain only the glosses; the full lexical data stays in Emdros.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

# Columns in the Hebrew/Aramaic lexicons mapped to Emdros verbal stem names.
STEM_COLUMNS = {
    "None": "none",
    "Qal": "qal",
    "Nifal": "nif",
    "Piel": "piel",
    "Pual": "pual",
    "Hitpael": "hit",
    "Hifil": "hif",
    "Hofal": "hof",
    "Hishtafal": "hsht",
    "Passive Qal": "pasq",
    "Etpaal": "etpa",
    "Nitpael": "nit",
    "Hotpaal": "hotp",
    "Tifal": "tif",
    "Hitpoal": "htpo",
    "Poal": "poal",
    "Poel": "poel",
    "Hitpaal": "htpa",
    "Etpeel": "etpe",
    "Peal": "peal",
    "Peil": "peil",
    "Pael": "pael",
    "Hafel": "haf",
    "Afel": "afel",
    "Shafel": "shaf",
}


def read_rows(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def put_gloss(target: dict[str, str], language: str, value: str) -> None:
    value = value.strip()
    if value:
        target[language] = value


def merge_stem_gloss(
    entry: dict[str, dict[str, str]],
    key: str,
    language: str,
    value: str,
) -> None:
    value = value.strip()
    if value:
        entry.setdefault(key, {})[language] = value


def import_hebrew(
    lexicon_dir: Path, entries: dict[str, dict]
) -> None:
    sources = [
        ("hebrew", "heb_es.csv", "heb_en.csv"),
        ("aramaic", "aram_es.csv", "aram_en.csv"),
    ]
    for language, spanish_name, english_name in sources:
        spanish_path = lexicon_dir / spanish_name
        english_path = lexicon_dir / english_name
        spanish = {
            row.get("lex", ""): row
            for row in read_rows(spanish_path)
            if row.get("lex")
        }
        english = {
            row.get("lex", ""): row
            for row in read_rows(english_path)
            if row.get("lex")
        }
        for key, row in spanish.items():
            entry: dict[str, dict[str, str]] = {}
            fallback = english.get(key, {})
            for column, stem in STEM_COLUMNS.items():
                if column not in row:
                    continue
                merge_stem_gloss(entry, stem, "es", row.get(column, ""))
                merge_stem_gloss(entry, stem, "en", fallback.get(column, ""))
            lexeme = row.get("Lexeme", "").strip()
            document: dict[str, object] = {}
            if entry:
                document["glosses"] = entry
            if lexeme:
                # The legacy word panel shows the lexeme together with its
                # Roman-numeral variant (for example "אָב I"). The Emdros
                # corpus only stores the base lexeme, so keep the variant in
                # the generated lexicon.
                document["lexeme"] = lexeme
            if document:
                entries[f"{language}:{key}"] = document


def import_greek(lexicon_dir: Path, entries: dict[str, dict]) -> None:
    spanish = {
        (row.get("Lexeme", ""), row.get("Strong's number", "")): row
        for row in read_rows(lexicon_dir / "greek_es.csv")
        if row.get("Lexeme")
    }
    english = {
        (row.get("Lexeme", ""), row.get("Strong's number", "")): row
        for row in read_rows(lexicon_dir / "greek_en.csv")
        if row.get("Lexeme")
    }
    for (lemma, strongs), row in spanish.items():
        glosses: dict[str, str] = {}
        put_gloss(glosses, "es", row.get("Gloss", ""))
        fallback = english.get((lemma, strongs))
        if fallback:
            put_gloss(glosses, "en", fallback.get("Gloss", ""))
        if glosses:
            entries[f"{lemma}|{strongs}"] = {"glosses": {"default": glosses}}


def import_latin(lexicon_dir: Path, entries: dict[str, dict]) -> None:
    spanish_path = lexicon_dir / "latin_es.csv"
    spanish = {}
    if spanish_path.exists():
        spanish = {
            (row.get("Lexeme", ""), row.get("Part of speech", "")): row
            for row in read_rows(spanish_path)
            if row.get("Lexeme")
        }
    english = {
        (row.get("Lexeme", ""), row.get("Part of speech", "")): row
        for row in read_rows(lexicon_dir / "latin_en.csv")
        if row.get("Lexeme")
    }
    for key, row in english.items():
        glosses: dict[str, str] = {}
        put_gloss(glosses, "en", row.get("Gloss", ""))
        fallback = spanish.get(key)
        if fallback:
            put_gloss(glosses, "es", fallback.get("Gloss", ""))
        if glosses:
            entries[f"{key[0]}|{key[1]}"] = {"glosses": {"default": glosses}}


def write_lexicon(
    output: Path,
    corpus: str,
    strategy: str,
    languages: list[str],
    entries: dict[str, dict],
) -> None:
    document = {
        "version": 1,
        "corpus": corpus,
        "strategy": strategy,
        "languages": languages,
        "entries": dict(sorted(entries.items())),
    }
    output.write_text(
        json.dumps(document, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {output} ({len(entries)} entries)")


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
        "--out",
        type=Path,
        default=repo_root / "data" / "lexicon",
        help="Output directory for generated lexicon JSON files",
    )
    args = parser.parse_args()

    lexicon_dir = args.legacy / "lexicons"
    if not lexicon_dir.exists():
        parser.error(f"Legacy lexicon directory not found: {lexicon_dir}")
    args.out.mkdir(parents=True, exist_ok=True)

    hebrew_entries: dict[str, dict] = {}
    import_hebrew(lexicon_dir, hebrew_entries)
    write_lexicon(
        args.out / "ETCBC4.json",
        "ETCBC4",
        "stem",
        ["es", "en"],
        hebrew_entries,
    )

    greek_entries: dict[str, dict] = {}
    import_greek(lexicon_dir, greek_entries)
    write_lexicon(
        args.out / "nestle1904.json",
        "nestle1904",
        "strongs",
        ["es", "en"],
        greek_entries,
    )

    latin_entries: dict[str, dict] = {}
    import_latin(lexicon_dir, latin_entries)
    write_lexicon(
        args.out / "jvulgate.json",
        "jvulgate",
        "lemma-pos",
        ["en", "es"],
        latin_entries,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
