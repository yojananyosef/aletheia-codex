import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { CorpusReader, NotFoundError } from "../src/index";

const dataDir = fileURLToPath(new URL("../../../data", import.meta.url));
const cataloguePath = join(dataDir, "metadata", "corpora.json");
const corporaDir = join(dataDir, "corpora");
const lexiconDir = join(dataDir, "lexicon");
const available =
  existsSync(cataloguePath) &&
  existsSync(join(corporaDir, "ETCBC4.v24")) &&
  existsSync(join(lexiconDir, "ETCBC4.json")) &&
  existsSync(join(lexiconDir, "nestle1904.json")) &&
  existsSync(join(lexiconDir, "jvulgate.json"));

const nfc = (value: string) => value.normalize("NFC");

describe.skipIf(!available)("CorpusReader", () => {
  const reader = new CorpusReader({ cataloguePath, corporaDir, lexiconDir });

  afterAll(() => {
    reader.close();
  });

  it("lists the three corpora in catalogue order", () => {
    expect(reader.listCorpora().map((corpus) => corpus.id)).toEqual([
      "ETCBC4",
      "nestle1904",
      "jvulgate",
    ]);
  });

  it("exposes the grammar groups and levels used by the reading view", () => {
    const hebrew = reader.getCorpus("ETCBC4");
    expect(hebrew.groups.map((group) => group.key)).toEqual([
      "form_in_text",
      "lexeme",
      "morphology",
      "glosses",
    ]);
    expect(hebrew.levels.map((level) => level.key)).toEqual([
      "word",
      "phrase",
      "clause",
      "sentence",
    ]);

    const greek = reader.getCorpus("nestle1904");
    expect(greek.levels.map((level) => level.key)).toEqual([
      "word",
      "clause2",
      "clause1",
      "sentence",
    ]);
  });

  it("reads Hebrew Genesis 1 with transliteration, lexeme, gloss and grammar", () => {
    const chapter = reader.getChapter("ETCBC4", "Genesis", 1);
    expect(chapter.corpus.direction).toBe("rtl");
    expect(chapter.corpus.hasTransliteration).toBe(true);
    expect(chapter.book.chapters).toBe(50);
    expect(chapter.verses).toHaveLength(31);

    const firstVerse = chapter.verses[0]!;
    expect(firstVerse.number).toBe(1);
    expect(firstVerse.label).toBe("Genesis 1:1");
    expect(firstVerse.words.length).toBeGreaterThan(4);

    const firstWord = firstVerse.words[0]!;
    expect(nfc(firstWord.text)).toContain(nfc("בְּ"));
    expect(firstWord.transliteration).toBe("bᵊ");
    expect(nfc(firstWord.lemma!)).toBe(nfc("בְּ"));
    expect(nfc(firstWord.lexemeVariant!)).toBe(nfc("בְּ"));
    expect(firstWord.gloss).toEqual({
      text: "en, a (hora, lugar); con; por; por medio de",
      language: "es",
    });

    const partOfSpeech = firstWord.features.find(
      (feature) => feature.enumName === "part_of_speech_t",
    );
    expect(partOfSpeech).toMatchObject({
      value: "prep",
      label: "Parte del discurso",
    });
    const language = firstWord.features.find(
      (feature) => feature.enumName === "language_t",
    );
    expect(language).toMatchObject({ value: "Hebrew" });

    const verbClass = chapter.verses
      .flatMap((verse) => verse.words)
      .flatMap((word) => word.features)
      .find((feature) => feature.key === "verb_class");
    expect(verbClass).toMatchObject({
      kind: "multi-enum",
      enumName: "verb_class_t",
    });
    expect(verbClass?.value).toBeTruthy();
  });

  it("builds a readable grammar tree for Hebrew", () => {
    const chapter = reader.getChapter("ETCBC4", "Genesis", 1);
    const objects = chapter.grammar.objects;
    expect(objects.length).toBeGreaterThan(50);
    expect(new Set(objects.map((object) => object.level))).toEqual(
      new Set(["phrase", "clause", "sentence"]),
    );

    const sentence = objects.find((object) => object.level === "sentence")!;
    expect(sentence.parentId).toBeNull();
    expect(sentence.depth).toBe(0);

    const phrase = objects.find((object) => object.level === "phrase")!;
    expect(phrase.parentId).toMatch(/^clause:/);
    expect(phrase.depth).toBeGreaterThan(1);

    const byId = new Map(objects.map((object) => [object.id, object]));
    for (const object of objects) {
      if (!object.parentId) {
        continue;
      }
      const parent = byId.get(object.parentId);
      expect(parent).toBeDefined();
      expect(parent!.depth).toBe(object.depth - 1);
      expect(parent!.firstMonad).toBeLessThanOrEqual(object.firstMonad);
      expect(parent!.lastMonad).toBeGreaterThanOrEqual(object.lastMonad);
    }
  });

  it("reads Greek Matthew 1 with glosses and nested clauses", () => {
    const chapter = reader.getChapter("nestle1904", "Matthew", 1);
    expect(chapter.corpus.direction).toBe("ltr");
    expect(chapter.corpus.hasTransliteration).toBe(false);
    expect(chapter.verses).toHaveLength(25);

    const firstWord = chapter.verses[0]!.words[0]!;
    expect(nfc(firstWord.text)).toBe(nfc("Βίβλος"));
    expect(firstWord.transliteration).toBeNull();
    expect(firstWord.gloss).toEqual({ text: "libro", language: "es" });
    expect(firstWord.features).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "psp",
          label: "Parte del discurso",
          value: "noun",
        }),
        expect.objectContaining({ key: "case", value: "nominative" }),
        expect.objectContaining({ key: "gender", value: "feminine" }),
      ]),
    );

    const objects = chapter.grammar.objects;
    expect(new Set(objects.map((object) => object.level))).toEqual(
      new Set(["clause2", "clause1", "sentence"]),
    );
    const inner = objects.find((object) => object.level === "clause2")!;
    expect(inner.parentId).toMatch(/^clause1:/);
    expect(inner.depth).toBe(2);
  });

  it("reads Latin Matthew 1 with morphology and sentence structure", () => {
    const chapter = reader.getChapter("jvulgate", "Matthew", 1);
    expect(chapter.corpus.direction).toBe("ltr");
    expect(chapter.verses).toHaveLength(25);

    const firstWord = chapter.verses[0]!.words[0]!;
    expect(firstWord.text).toBe("liber");
    expect(firstWord.lemma).toBe("liber");
    expect(firstWord.gloss).toBeNull();
    expect(firstWord.features).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "psp", value: "noun" }),
        expect.objectContaining({ key: "gender", value: "masculine" }),
        expect.objectContaining({ key: "declension", value: "second_d_er" }),
      ]),
    );

    expect(
      chapter.grammar.objects.every(
        (object) => object.level === "sentence" && object.parentId === null,
      ),
    ).toBe(true);
  });

  it("uses the database book numbers instead of the display order", () => {
    const psalms = reader.getChapter("ETCBC4", "Psalmi", 119);
    expect(psalms.book.number).toBe(19);
    expect(psalms.verses).toHaveLength(176);
  });

  it("accepts the last chapter and rejects the next one", () => {
    expect(
      reader.getChapter("ETCBC4", "Genesis", 50).verses.length,
    ).toBeGreaterThan(0);
    expect(() => reader.getChapter("ETCBC4", "Genesis", 51)).toThrow(
      NotFoundError,
    );
  });

  it("reports unknown corpora, books and chapters as not found", () => {
    expect(() => reader.getCorpus("missing")).toThrow(NotFoundError);
    expect(() => reader.getBook("ETCBC4", "missing")).toThrow(NotFoundError);
    expect(() => reader.getChapter("ETCBC4", "Genesis", 0)).toThrow(
      NotFoundError,
    );
    expect(() => reader.getChapter("ETCBC4", "Genesis", 1.5)).toThrow(
      NotFoundError,
    );
  });
});
