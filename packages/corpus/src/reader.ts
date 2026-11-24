import { existsSync, readFileSync } from "node:fs";
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
  type GrammarLevelDefinition,
  type GrammarObject,
  type Verse,
  type Word,
  type WordGloss,
} from "@aletheia-codex/contracts";
import { loadCatalogue } from "./metadata.js";

export interface CorpusReaderOptions {
  cataloguePath: string;
  corporaDir: string;
  lexiconDir?: string;
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
  [feature: string]: string | number | null;
}

interface ObjectRow {
  id: number;
  first_monad: number;
  last_monad: number;
  [feature: string]: string | number | null;
}

interface LexiconEntry {
  glosses?: Record<string, Record<string, string>>;
  lexeme?: string;
}

interface LexiconDocument {
  entries: Record<string, LexiconEntry>;
}

interface LevelRows {
  level: GrammarLevelDefinition;
  rows: ObjectRow[];
}

const IGNORED_VALUES = new Set(["NA", "absent", "unknown", "false"]);

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
    groups: corpus.groups,
    levels: corpus.levels,
    gloss: corpus.gloss,
    books: corpus.books,
  };
}

function featureValue(
  feature: FeatureDefinition,
  raw: unknown,
): FeatureValue | null {
  if (feature.kind === "string") {
    if (typeof raw !== "string") {
      return null;
    }
    const value = raw.trim();
    if (!value) {
      return null;
    }
    return {
      key: feature.key,
      label: feature.label,
      kind: feature.kind,
      value,
      enumName: null,
    };
  }

  if (feature.kind === "number") {
    if (typeof raw !== "number" && typeof raw !== "string") {
      return null;
    }
    const value = String(raw).trim();
    if (!value) {
      return null;
    }
    return {
      key: feature.key,
      label: feature.label,
      kind: feature.kind,
      value,
      enumName: null,
    };
  }

  if (feature.kind === "multi-enum") {
    if (typeof raw !== "string" && typeof raw !== "number") {
      return null;
    }
    const values = String(raw)
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((item) => feature.values[item])
      .filter(
        (item): item is string =>
          typeof item === "string" && !IGNORED_VALUES.has(item),
      );
    if (values.length === 0) {
      return null;
    }
    return {
      key: feature.key,
      label: feature.label,
      kind: feature.kind,
      value: values.join(","),
      enumName: feature.enum,
    };
  }

  if (typeof raw !== "number" && typeof raw !== "string") {
    return null;
  }
  const value = feature.values[String(raw)];
  if (!value || IGNORED_VALUES.has(value)) {
    return null;
  }
  return {
    key: feature.key,
    label: feature.label,
    kind: feature.kind,
    value,
    enumName: feature.enum,
  };
}

function featureSql(
  features: FeatureDefinition[],
  tableAlias: string,
  joins: string[],
): string {
  return features
    .map((feature, index) => {
      const alias = `f${index}`;
      if (feature.kind === "string") {
        if (feature.table) {
          joins.push(
            `LEFT JOIN ${feature.table} ${alias} ON ${alias}.id_d = ${tableAlias}.mdf_${feature.key}`,
          );
          return `${alias}.string_value AS feature_${index}`;
        }
        return `${tableAlias}.mdf_${feature.key} AS feature_${index}`;
      }
      return `${tableAlias}.mdf_${feature.key} AS feature_${index}`;
    })
    .join(",\n        ");
}

export class CorpusReader {
  readonly #catalogue: CorpusCatalogue;
  readonly #corporaDir: string;
  readonly #lexiconDir: string;
  readonly #connections = new Map<string, Database.Database>();
  readonly #lexicons = new Map<string, LexiconDocument | null>();

  constructor({ cataloguePath, corporaDir, lexiconDir }: CorpusReaderOptions) {
    this.#catalogue = loadCatalogue(cataloguePath);
    this.#corporaDir = corporaDir;
    this.#lexiconDir = lexiconDir ?? join(corporaDir, "..", "lexicon");
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
    const lexicon = this.#lexicon(corpus);
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
          const word = this.#toWord(corpus, row, verse.verse, lexicon);
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
      grammar: {
        objects: this.#readGrammarObjects(
          database,
          corpus,
          verses,
          firstMonad,
          lastMonad,
        ),
      },
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

  #lexicon(corpus: CorpusMetadata): LexiconDocument | null {
    const cached = this.#lexicons.get(corpus.id);
    if (cached !== undefined) {
      return cached;
    }
    if (!corpus.gloss) {
      this.#lexicons.set(corpus.id, null);
      return null;
    }
    const path = join(this.#lexiconDir, corpus.gloss.file);
    if (!existsSync(path)) {
      this.#lexicons.set(corpus.id, null);
      return null;
    }
    const document = JSON.parse(readFileSync(path, "utf8")) as LexiconDocument;
    this.#lexicons.set(corpus.id, document);
    return document;
  }

  #readWords(
    database: Database.Database,
    corpus: CorpusMetadata,
    firstMonad: number,
    lastMonad: number,
  ): WordRow[] {
    const joins: string[] = [];
    const featureSelects = featureSql(corpus.features, "w", joins);
    const transliterationSelect = corpus.transliteration
      ? "tr.string_value AS translit"
      : "NULL AS translit";
    const transliterationJoin = corpus.transliteration
      ? `LEFT JOIN ${corpus.transliteration.table} tr ON tr.id_d = w.mdf_${corpus.transliteration.key}`
      : "";

    const sql = `
      SELECT
        w.first_monad AS monad,
        surface.string_value AS text,
        lemma.string_value AS lemma,
        ${transliterationSelect}
        ${featureSelects ? `, ${featureSelects}` : ""}
      FROM word_objects w
      LEFT JOIN ${corpus.surface.table} surface ON surface.id_d = w.mdf_${corpus.surface.key}
      LEFT JOIN ${corpus.lemma.table} lemma ON lemma.id_d = w.mdf_${corpus.lemma.key}
      ${transliterationJoin}
      ${joins.join("\n      ")}
      WHERE w.first_monad BETWEEN ? AND ?
      ORDER BY w.first_monad, w.object_id_d
    `;

    return database.prepare(sql).all(firstMonad, lastMonad) as WordRow[];
  }

  #toWord(
    corpus: CorpusMetadata,
    row: WordRow,
    verse: number,
    lexicon: LexiconDocument | null,
  ): Word | null {
    const text = row.text?.trim() ?? "";
    if (!text) {
      return null;
    }

    const features: FeatureValue[] = [];
    const values = new Map<string, string>();
    corpus.features.forEach((feature, index) => {
      const value = featureValue(feature, row[`feature_${index}`]);
      if (value) {
        features.push(value);
        values.set(feature.key, value.value);
      }
    });

    const lemma = row.lemma?.trim() || null;
    return {
      monad: row.monad,
      verse,
      text,
      transliteration: row.translit?.trim() || null,
      lemma,
      lexemeVariant: this.#resolveLexeme(corpus, lemma, values, lexicon),
      gloss: this.#resolveGloss(corpus, lemma, values, lexicon),
      features,
    };
  }

  #lexiconKey(
    corpus: CorpusMetadata,
    lemma: string | null,
    values: Map<string, string>,
  ): string | null {
    const config = corpus.gloss;
    if (!config) {
      return null;
    }

    if (config.strategy === "stem") {
      const language = values.get("language");
      const lex = values.get("lex");
      return language && lex ? `${language.toLowerCase()}:${lex}` : null;
    }
    if (config.strategy === "strongs") {
      const strongs = values.get("strongs");
      return lemma && strongs ? `${lemma}|${strongs}` : null;
    }
    const partOfSpeech = values.get("psp");
    return lemma && partOfSpeech ? `${lemma}|${partOfSpeech}` : null;
  }

  #resolveLexeme(
    corpus: CorpusMetadata,
    lemma: string | null,
    values: Map<string, string>,
    lexicon: LexiconDocument | null,
  ): string | null {
    if (!lexicon) {
      return null;
    }
    const key = this.#lexiconKey(corpus, lemma, values);
    return key ? lexicon.entries[key]?.lexeme?.trim() || null : null;
  }

  #resolveGloss(
    corpus: CorpusMetadata,
    lemma: string | null,
    values: Map<string, string>,
    lexicon: LexiconDocument | null,
  ): WordGloss | null {
    const config = corpus.gloss;
    if (!config || !lexicon) {
      return null;
    }

    const key = this.#lexiconKey(corpus, lemma, values);
    if (!key) {
      return null;
    }
    const entry = lexicon.entries[key];
    if (!entry?.glosses) {
      return null;
    }

    let glosses: Record<string, string> | undefined;
    if (config.strategy === "stem") {
      const stem = values.get("vs") ?? "none";
      glosses = entry.glosses[stem] ?? entry.glosses.none;
    } else {
      glosses = entry.glosses.default;
    }
    if (!glosses) {
      return null;
    }

    for (const language of config.languages) {
      const text = glosses[language]?.trim();
      if (text) {
        return { text, language };
      }
    }
    return null;
  }

  #readGrammarObjects(
    database: Database.Database,
    corpus: CorpusMetadata,
    verses: VerseRow[],
    firstMonad: number,
    lastMonad: number,
  ): GrammarObject[] {
    const levels = corpus.levels.filter((level) => level.key !== "word");
    const levelRows: LevelRows[] = levels.map((level) => {
      const joins: string[] = [];
      const selectFeatures = featureSql(level.features, "t", joins);
      const sql = `
        SELECT
          t.object_id_d AS id,
          t.first_monad AS first_monad,
          t.last_monad AS last_monad
          ${selectFeatures ? `, ${selectFeatures}` : ""}
        FROM ${level.table} t
        ${joins.join("\n        ")}
        WHERE t.last_monad >= ? AND t.first_monad <= ?
        ORDER BY t.first_monad, t.last_monad DESC, t.object_id_d
      `;
      return {
        level,
        rows: database.prepare(sql).all(firstMonad, lastMonad) as ObjectRow[],
      };
    });

    const verseByMonad = new Map<number, number>();
    for (const verse of verses) {
      for (
        let monad = verse.first_monad;
        monad <= verse.last_monad;
        monad += 1
      ) {
        verseByMonad.set(monad, verse.verse);
      }
    }
    const verseAt = (monad: number): number => {
      const found = verseByMonad.get(monad);
      if (found !== undefined) {
        return found;
      }
      let closest = verses[0]!.verse;
      for (const verse of verses) {
        if (monad >= verse.first_monad) {
          closest = verse.verse;
        }
      }
      return closest;
    };

    const rankByLevel = new Map(
      corpus.levels.map((level) => [level.key, level.rank]),
    );
    const objects: Array<GrammarObject & { rank: number }> = [];
    for (const { level, rows } of levelRows) {
      const rank = rankByLevel.get(level.key) ?? 0;
      for (const row of rows) {
        objects.push({
          id: `${level.key}:${row.id}`,
          level: level.key,
          label: level.label,
          firstMonad: row.first_monad,
          lastMonad: row.last_monad,
          verseStart: verseAt(row.first_monad),
          verseEnd: verseAt(row.last_monad),
          features: this.#toFeatures(level.features, row),
          parentId: null,
          depth: 0,
          rank,
        });
      }
    }

    for (const object of objects) {
      let parent: (GrammarObject & { rank: number }) | null = null;
      for (const candidate of objects) {
        if (candidate.rank <= object.rank) {
          continue;
        }
        if (
          candidate.firstMonad > object.firstMonad ||
          candidate.lastMonad < object.lastMonad
        ) {
          continue;
        }
        if (
          !parent ||
          candidate.lastMonad - candidate.firstMonad <
            parent.lastMonad - parent.firstMonad ||
          (candidate.lastMonad - candidate.firstMonad ===
            parent.lastMonad - parent.firstMonad &&
            candidate.rank < parent.rank)
        ) {
          parent = candidate;
        }
      }
      object.parentId = parent?.id ?? null;
    }

    const byId = new Map(objects.map((object) => [object.id, object]));
    const depthOf = (object: GrammarObject & { rank: number }): number => {
      let depth = 0;
      let current = object.parentId ? byId.get(object.parentId) : null;
      while (current) {
        depth += 1;
        current = current.parentId ? byId.get(current.parentId) : null;
      }
      return depth;
    };
    for (const object of objects) {
      object.depth = depthOf(object);
    }

    objects.sort(
      (left, right) =>
        left.firstMonad - right.firstMonad ||
        left.rank - right.rank ||
        right.lastMonad - left.lastMonad,
    );
    return objects.map((object): GrammarObject => ({
      id: object.id,
      level: object.level,
      label: object.label,
      firstMonad: object.firstMonad,
      lastMonad: object.lastMonad,
      verseStart: object.verseStart,
      verseEnd: object.verseEnd,
      features: object.features,
      parentId: object.parentId,
      depth: object.depth,
    }));
  }

  #toFeatures(
    features: FeatureDefinition[],
    row: WordRow | ObjectRow,
  ): FeatureValue[] {
    const values: FeatureValue[] = [];
    features.forEach((feature, index) => {
      const value = featureValue(feature, row[`feature_${index}`]);
      if (value) {
        values.push(value);
      }
    });
    return values;
  }
}
