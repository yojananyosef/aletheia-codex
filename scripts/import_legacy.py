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

# Curated word features for reading. Keys are Emdros feature names and the
# values mirror the order used by the legacy sentencegrammar configuration.
# Each entry is (key, Spanish label, kind, enum name).
WORD_FEATURES = {
    "ETCBC4": [
        ("sp", "Categoría", "enum", "part_of_speech_t"),
        ("pdp", "Parte dependiente del discurso", "enum", "part_of_speech_t"),
        ("ls", "Conjunto lexical", "enum", "lexical_set_t"),
        ("verb_class", "Clase verbal", "multi-enum", "verb_class_t"),
        ("vs", "Raíz", "enum", "verbal_stem_t"),
        ("vt", "Tiempo", "enum", "verbal_tense_t"),
        ("st", "Estado", "enum", "state_t"),
        ("ps", "Persona", "enum", "person_t"),
        ("gn", "Género", "enum", "gender_t"),
        ("nu", "Número", "enum", "number_t"),
        ("suffix_person", "Persona del sufijo", "enum", "person_t"),
        ("suffix_gender", "Género del sufijo", "enum", "gender_t"),
        ("suffix_number", "Número del sufijo", "enum", "number_t"),
        ("language", "Idioma", "enum", "language_t"),
        ("lexeme_occurrences", "Ocurrencias", "number", None),
        ("frequency_rank", "Rango de frecuencia", "number", None),
        ("g_lex_utf8", "Lexical stem", "string", None),
        ("g_vbs_utf8", "Formación de raíz", "string", None),
        ("g_pfm_utf8", "Preformativo", "string", None),
        ("g_vbe_utf8", "Terminación verbal", "string", None),
        ("g_nme_utf8", "Terminación nominal", "string", None),
        ("g_prs_utf8", "Sufijo pronominal", "string", None),
        ("g_uvf_utf8", "Final univalente", "string", None),
        ("qere_utf8", "Qere", "string", None),
        ("g_voc_lex_translit", "Lexema (transliterado)", "string", None),
        ("lex", "Código de lexema", "string", None),
    ],
    "nestle1904": [
        ("psp", "Categoría", "enum", "psp_t"),
        ("case", "Caso", "enum", "case_t"),
        ("number", "Número", "enum", "number_t"),
        ("gender", "Género", "enum", "gender_t"),
        ("person", "Persona", "enum", "person_t"),
        ("tense", "Tiempo", "enum", "tense_t"),
        ("voice", "Voz", "enum", "voice_t"),
        ("mood", "Modo", "enum", "mood_t"),
        ("possessor_number", "Número del poseedor", "enum", "number_t"),
        ("suffix", "Sufijo", "enum", "suffix_t"),
        ("verb_type", "Tipo verbal", "enum", "verb_type_t"),
        ("noun_declension", "Declinación nominal", "enum", "noun_declension_t"),
        ("noun_stem", "Raíz nominal", "enum", "noun_stem_t"),
        ("strongs", "Número Strong", "number", None),
        ("strongs_unreliable", "Strong no fiable", "enum", "boolean_t"),
        ("lexeme_occurrences", "Ocurrencias", "number", None),
        ("frequency_rank", "Rango de frecuencia", "number", None),
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
        ("lexeme_occurrences", "Ocurrencias", "number", None),
        ("frequency_rank", "Rango de frecuencia", "number", None),
    ],
}

HIDDEN_FEATURES = {
    "ETCBC4": {"lex"},
    "nestle1904": set(),
    "jvulgate": set(),
}

LEMMA_FEATURES = {
    "ETCBC4": "g_voc_lex_utf8",
    "nestle1904": "lemma",
    "jvulgate": "lemma_with_variant",
}

TRANSLITERATION_FEATURES = {
    "ETCBC4": "g_word_translit",
    "nestle1904": None,
    "jvulgate": None,
}

GLOSS_CONFIG = {
    "ETCBC4": {
        "file": "ETCBC4.json",
        "languages": ["es", "en"],
        "strategy": "stem",
    },
    "nestle1904": {
        "file": "nestle1904.json",
        "languages": ["es", "en"],
        "strategy": "strongs",
    },
    "jvulgate": {
        "file": "jvulgate.json",
        "languages": ["en", "es"],
        "strategy": "lemma-pos",
    },
}

# Groups and their order come from the legacy sentencegrammar configuration.
WORD_GROUPS = {
    "ETCBC4": [
        {
            "key": "form_in_text",
            "label": "Forma en el texto",
            "features": [
                "g_lex_utf8",
                "g_vbs_utf8",
                "g_pfm_utf8",
                "g_vbe_utf8",
                "g_nme_utf8",
                "g_prs_utf8",
                "g_uvf_utf8",
                "qere_utf8",
            ],
            "metaFeatures": [],
        },
        {
            "key": "lexeme",
            "label": "Lexema",
            "features": [
                "g_voc_lex_translit",
                "lexeme_occurrences",
                "frequency_rank",
                "sp",
                "pdp",
                "ls",
                "verb_class",
                "language",
            ],
            "metaFeatures": [],
        },
        {
            "key": "morphology",
            "label": "Morfología",
            "features": ["vs", "vt", "st"],
            "metaFeatures": [
                {
                    "key": "pgn",
                    "label": "Persona, género, número",
                    "features": ["ps", "gn", "nu"],
                },
                {
                    "key": "suffix_pgn",
                    "label": "Sufijo: persona, género, número",
                    "features": ["suffix_person", "suffix_gender", "suffix_number"],
                },
            ],
        },
        {"key": "glosses", "label": "Glosas", "features": [], "metaFeatures": []},
    ],
    "nestle1904": [
        {
            "key": "lexeme",
            "label": "Lexema",
            "features": [
                "strongs",
                "strongs_unreliable",
                "lexeme_occurrences",
                "frequency_rank",
                "psp",
                "verb_type",
                "noun_declension",
                "noun_stem",
            ],
            "metaFeatures": [],
        },
        {
            "key": "morphology",
            "label": "Morfología",
            "features": ["case", "possessor_number", "tense", "mood", "voice", "suffix"],
            "metaFeatures": [
                {
                    "key": "pgn",
                    "label": "Persona, género, número",
                    "features": ["person", "gender", "number"],
                }
            ],
        },
        {"key": "glosses", "label": "Glosas", "features": [], "metaFeatures": []},
    ],
    "jvulgate": [
        {
            "key": "lexeme",
            "label": "Lexema",
            "features": [
                "lexeme_occurrences",
                "frequency_rank",
                "psp",
                "conjugation",
                "declension",
                "stem",
            ],
            "metaFeatures": [],
        },
        {
            "key": "morphology",
            "label": "Morfología",
            "features": ["case", "tense", "mood", "voice", "degree"],
            "metaFeatures": [
                {
                    "key": "pgn",
                    "label": "Persona, género, número",
                    "features": ["person", "gender", "number"],
                }
            ],
        },
        {"key": "glosses", "label": "Glosas", "features": [], "metaFeatures": []},
    ],
}

# Higher-level grammatical objects, ordered from lower to higher.
LEVELS = {
    "ETCBC4": [
        ("word", "Palabra", "word_objects", 0, None),
        ("phrase", "Frase", "phrase_objects", 1, "#43B02A"),
        ("clause", "Cláusula", "clause_objects", 2, "#C35CF4"),
        ("sentence", "Oración", "sentence_objects", 3, "#006187"),
    ],
    # The legacy sentencegrammar lists the objects from inner to outer. In the
    # Nestle corpus the clause2 objects (clause constituents) are contained in
    # the clause1 objects, so clause2 is the inner display level.
    "nestle1904": [
        ("word", "Palabra", "word_objects", 0, None),
        ("clause2", "Cláusula nivel 2", "clause2_objects", 1, "#43B02A"),
        ("clause1", "Cláusula nivel 1", "clause1_objects", 2, "#C35CF4"),
        ("sentence", "Oración", "sentence_objects", 3, "#006187"),
    ],
    "jvulgate": [
        ("word", "Palabra", "word_objects", 0, None),
        ("sentence", "Oración", "sentence_objects", 3, "#006187"),
    ],
}

LEVEL_FEATURES = {
    "phrase": [
        ("typ", "Tipo", "enum", "phrase_type_t"),
        ("function", "Función", "enum", "phrase_function_t"),
        ("det", "Determinación", "enum", "phrase_determination_t"),
        ("rela", "Relación", "enum", "phrase_relation_t"),
    ],
    "clause": [
        ("typ", "Tipo", "enum", "clause_type_t"),
        ("kind", "Clase", "enum", "clause_kind_t"),
        ("rela", "Relación", "enum", "clause_constituent_relation_t"),
        ("txt", "Tipo de texto", "string", None),
        ("domain", "Dominio", "string", None),
    ],
    "clause1": [("typ", "Función", "enum", "clause_type_t")],
    "clause2": [("typ", "Función", "enum", "clause_type_t")],
    "sentence": [],
}


def read_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def table_exists(connection: sqlite3.Connection, table: str) -> bool:
    row = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)
    ).fetchone()
    return row is not None


def column_exists(connection: sqlite3.Connection, table: str, column: str) -> bool:
    return any(row[1] == column for row in connection.execute(f"PRAGMA table_info({table})"))


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


def feature_table(connection: sqlite3.Connection, table_prefix: str, key: str) -> str | None:
    table = f"{table_prefix}_mdf_{key}_set"
    return table if table_exists(connection, table) else None


def build_feature(
    connection: sqlite3.Connection,
    table_prefix: str,
    object_table: str,
    spec: tuple[str, str, str, str | None],
    hidden: bool,
) -> dict:
    key, label, kind, enum_name = spec
    if not column_exists(connection, object_table, f"mdf_{key}"):
        raise RuntimeError(f"{object_table}: missing column mdf_{key}")

    feature = {"key": key, "label": label, "kind": kind}
    if kind in ("enum", "multi-enum"):
        assert enum_name is not None
        values = enum_values(connection, enum_name)
        if not values:
            raise RuntimeError(
                f"{object_table}: missing enum {enum_name} for feature {key}"
            )
        feature["enum"] = enum_name
        feature["values"] = values
    elif kind == "string":
        feature["table"] = feature_table(connection, table_prefix, key)
    elif kind != "number":
        raise RuntimeError(f"Unsupported feature kind: {kind}")

    if hidden:
        feature["hidden"] = True
    return feature


def build_word_features(connection: sqlite3.Connection, corpus_id: str) -> list[dict]:
    hidden = HIDDEN_FEATURES[corpus_id]
    return [
        build_feature(
            connection,
            "word",
            "word_objects",
            spec,
            hidden=spec[0] in hidden,
        )
        for spec in WORD_FEATURES[corpus_id]
    ]


def build_levels(connection: sqlite3.Connection, corpus_id: str, word_features: list[dict]) -> list[dict]:
    levels: list[dict] = []
    for key, label, table, rank, color in LEVELS[corpus_id]:
        if not table_exists(connection, table):
            raise RuntimeError(f"{corpus_id}: missing table {table}")
        if key == "word":
            features = word_features
        else:
            features = [
                build_feature(connection, key, table, spec, hidden=False)
                for spec in LEVEL_FEATURES.get(key, [])
            ]
        levels.append(
            {
                "key": key,
                "label": label,
                "table": table,
                "rank": rank,
                "color": color,
                "features": features,
            }
        )
    return levels


def validate_groups(corpus_id: str, features: list[dict], groups: list[dict]) -> None:
    keys = {feature["key"] for feature in features}
    for group in groups:
        for key in group["features"]:
            if key not in keys:
                raise RuntimeError(f"{corpus_id}: group {group['key']} references {key}")
        for meta in group["metaFeatures"]:
            for key in meta["features"]:
                if key not in keys:
                    raise RuntimeError(
                        f"{corpus_id}: meta feature {meta['key']} references {key}"
                    )


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

        features = build_word_features(connection, corpus_id)
        groups = WORD_GROUPS[corpus_id]
        validate_groups(corpus_id, features, groups)
        levels = build_levels(connection, corpus_id, features)
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
            "groups": groups,
            "levels": levels,
            "gloss": GLOSS_CONFIG[corpus_id],
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
        "version": 2,
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
