import { existsSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import {
  NotFoundError,
  type Book,
  type Chapter,
  type CorpusCatalogue,
  type CorpusMetadata,
  type CorpusSummary,
  type FeatureDefinition,
  type FeatureValue,
  type Verse,
  type Word,
} from "@bibleol/contracts";
import { loadCatalogue } from "./metadata.js";

export interface CorpusReaderOptions {
  cataloguePath: string;
  corporaDir: string;
}

interface VerseRow {
  first_monad: number;
  last_monad: number;
  verse: number;
}

interface WordRow {
  monad: number;
  text: string | null;
  lemma: string | null;
  translit: string | null;
  [feature: `feature_${number}`]: string | number | null;
}

const IGNORED_VALUES = new Set(["NA", "absent", "unknown"]);

function toSummary(corpus: CorpusMetadata): CorpusSummary {
  return {
    id: corpus.id,
    name: corpus.name,
    title: corpus.title,
    version: corpus.version,
    language: corpus.language,
    languageName: corpus.languageName,
    direction: corpus.direction,
    hasTransliteration: corpus.transliteration !== null,
    books: corpus.books,
  };
}

function featureValue(feature: FeatureDefinition, raw: unknown): string | null {
  if (feature.kind === "string") {
    return typeof raw === "string" && raw.trim() ? raw.trim() : null;
  }
  if (typeof raw !== "number" && typeof raw !== "string") {
    return null;
  }
  const value = feature.values[String(raw)];
  if (!value || IGNORED_VALUES.has(value)) {
    return null;
  }
  return value;
}

export class CorpusReader {
  readonly #catalogue: CorpusCatalogue;
  readonly #corporaDir: string;
  readonly #connections = new Map<string, Database.Database>();

  constructor({ cataloguePath, corporaDir }: CorpusReaderOptions) {
    this.#catalogue = loadCatalogue(cataloguePath);
    this.#corporaDir = corporaDir;
  }

  listCorpora(): CorpusSummary[] {
    return this.#catalogue.corpora.map(toSummary);
  }

  getCorpus(id: string): CorpusSummary {
    return toSummary(this.#metadata(id));
  }

  getBook(corpusId: string, bookId: string): Book {
    const book = this.#metadata(corpusId).books.find(
      (item) => item.id === bookId,
    );
    if (!book) {
      throw new NotFoundError(`Book not found: ${corpusId}/${bookId}`);
    }
    return book;
  }

  getChapter(corpusId: string, bookId: string, chapterNumber: number): Chapter {
    const corpus = this.#metadata(corpusId);
    const book = this.getBook(corpusId, bookId);
    if (
      !Number.isInteger(chapterNumber) ||
      chapterNumber < 1 ||
      chapterNumber > book.chapters
    ) {
      throw new NotFoundError(
        `Chapter not found: ${corpusId}/${bookId}/${chapterNumber}`,
      );
    }

    const database = this.#database(corpus);
    const verses = database
      .prepare(
        `SELECT first_monad, last_monad, mdf_verse AS verse
         FROM verse_objects
         WHERE mdf_book = ? AND mdf_chapter = ?
         ORDER BY mdf_verse`,
      )
      .all(book.number, chapterNumber) as VerseRow[];

    if (verses.length === 0) {
      throw new NotFoundError(
        `Chapter not found: ${corpusId}/${bookId}/${chapterNumber}`,
      );
    }

    const firstMonad = verses[0]!.first_monad;
    const lastMonad = verses[verses.length - 1]!.last_monad;
    const rows = this.#readWords(database, corpus, firstMonad, lastMonad);
    const wordsByVerse = new Map<number, Word[]>();
    let rowIndex = 0;

    for (const verse of verses) {
      const words: Word[] = [];
      while (
        rowIndex < rows.length &&
        rows[rowIndex]!.monad <= verse.last_monad
      ) {
        const row = rows[rowIndex]!;
        if (row.monad >= verse.first_monad) {
          const word = this.#toWord(corpus, row);
          if (word) {
            words.push(word);
          }
        }
        rowIndex += 1;
      }
      wordsByVerse.set(verse.verse, words);
    }

    const chapterVerses: Verse[] = verses.map((verse) => ({
      number: verse.verse,
      label: `${book.name} ${chapterNumber}:${verse.verse}`,
      words: wordsByVerse.get(verse.verse) ?? [],
    }));

    return {
      corpus: toSummary(corpus),
      book,
      chapter: chapterNumber,
      verses: chapterVerses,
    };
  }

  close(): void {
    for (const connection of this.#connections.values()) {
      connection.close();
    }
    this.#connections.clear();
  }

  #metadata(id: string): CorpusMetadata {
    const corpus = this.#catalogue.corpora.find((item) => item.id === id);
    if (!corpus) {
      throw new NotFoundError(`Corpus not found: ${id}`);
    }
    return corpus;
  }

  #database(corpus: CorpusMetadata): Database.Database {
    const cached = this.#connections.get(corpus.id);
    if (cached) {
      return cached;
    }
    const path = join(this.#corporaDir, corpus.file);
    if (!existsSync(path)) {
      throw new Error(
        `Corpus file missing: ${path}. Run python3 scripts/sync_corpora.py.`,
      );
    }
    const connection = new Database(path, {
      readonly: true,
      fileMustExist: true,
    });
    this.#connections.set(corpus.id, connection);
    return connection;
  }

  #readWords(
    database: Database.Database,
    corpus: CorpusMetadata,
    firstMonad: number,
    lastMonad: number,
  ): WordRow[] {
    const featureSelects = corpus.features.map((feature, index) =>
      feature.kind === "enum"
        ? `w.mdf_${feature.key} AS feature_${index}`
        : `f${index}.string_value AS feature_${index}`,
    );
    const featureJoins = corpus.features.flatMap((feature, index) =>
      feature.kind === "string"
        ? [
            `LEFT JOIN ${feature.table} f${index} ON f${index}.id_d = w.first_monad`,
          ]
        : [],
    );
    const transliterationSelect = corpus.transliteration
      ? "tr.string_value AS translit"
      : "NULL AS translit";
    const transliterationJoin = corpus.transliteration
      ? `LEFT JOIN ${corpus.transliteration.table} tr ON tr.id_d = w.first_monad`
      : "";

    const sql = `
      SELECT
        w.first_monad AS monad,
        surface.string_value AS text,
        lemma.string_value AS lemma,
        ${transliterationSelect}
        ${featureSelects.length ? `, ${featureSelects.join(",\n        ")}` : ""}
      FROM word_objects w
      LEFT JOIN ${corpus.surface.table} surface ON surface.id_d = w.first_monad
      LEFT JOIN ${corpus.lemma.table} lemma ON lemma.id_d = w.first_monad
      ${transliterationJoin}
      ${featureJoins.join("\n      ")}
      WHERE w.first_monad BETWEEN ? AND ?
      ORDER BY w.first_monad
    `;

    return database.prepare(sql).all(firstMonad, lastMonad) as WordRow[];
  }

  #toWord(corpus: CorpusMetadata, row: WordRow): Word | null {
    const text = row.text?.trim() ?? "";
    if (!text) {
      return null;
    }

    const features: FeatureValue[] = [];
    corpus.features.forEach((feature, index) => {
      const value = featureValue(feature, row[`feature_${index}`]);
      if (value) {
        features.push({
          key: feature.key,
          label: feature.label,
          value,
          enumName: feature.kind === "enum" ? feature.enum : null,
        });
      }
    });

    return {
      monad: row.monad,
      text,
      transliteration: row.translit?.trim() || null,
      lemma: row.lemma?.trim() || null,
      features,
    };
  }
}
