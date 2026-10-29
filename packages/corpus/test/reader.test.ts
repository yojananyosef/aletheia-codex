import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { CorpusReader, NotFoundError } from "../src/index";

const dataDir = fileURLToPath(new URL("../../../data", import.meta.url));
const cataloguePath = join(dataDir, "metadata", "corpora.json");
const corporaDir = join(dataDir, "corpora");
const available =
  existsSync(cataloguePath) && existsSync(join(corporaDir, "ETCBC4.v24"));

const nfc = (value: string) => value.normalize("NFC");

describe.skipIf(!available)("CorpusReader", () => {
  const reader = new CorpusReader({ cataloguePath, corporaDir });

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

  it("reads Hebrew Genesis 1 with transliteration and grammar", () => {
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
    expect(firstWord.lemma).toBeTruthy();

    const partOfSpeech = firstWord.features.find(
      (feature) => feature.enumName === "part_of_speech_t",
    );
    expect(partOfSpeech).toMatchObject({ value: "prep" });
    const language = firstWord.features.find(
      (feature) => feature.enumName === "language_t",
    );
    expect(language).toMatchObject({ value: "Hebrew" });
  });

  it("reads Greek Matthew 1 without transliteration", () => {
    const chapter = reader.getChapter("nestle1904", "Matthew", 1);
    expect(chapter.corpus.direction).toBe("ltr");
    expect(chapter.corpus.hasTransliteration).toBe(false);
    expect(chapter.verses).toHaveLength(25);
    expect(nfc(chapter.verses[0]!.words[0]!.text)).toBe(nfc("Βίβλος"));
    expect(chapter.verses[0]!.words[0]!.transliteration).toBeNull();
  });

  it("reads Latin Matthew 1", () => {
    const chapter = reader.getChapter("jvulgate", "Matthew", 1);
    expect(chapter.corpus.direction).toBe("ltr");
    expect(chapter.verses).toHaveLength(25);
    expect(chapter.verses[0]!.words[0]!.text).toBe("liber");
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
