import { describe, expect, it } from "vitest";
import { chapterUrl, explainUrl } from "../src/lib/urls";

describe("chapterUrl", () => {
  it("preserves the open AI assistant across chapters", () => {
    expect(chapterUrl("ETCBC4", "Genesis", 2, { ai: true })).toBe(
      "/read/ETCBC4/Genesis/2?ai=1",
    );
    expect(chapterUrl("ETCBC4", "Genesis", 2)).toBe("/read/ETCBC4/Genesis/2");
  });
});

describe("explainUrl", () => {
  it("builds a canonical explanation URL without query noise", () => {
    expect(explainUrl("ETCBC4", "Genesis", 1)).toBe(
      "/read/ETCBC4/Genesis/1/explain",
    );
  });

  it("preserves the mode, range and reading options", () => {
    expect(
      explainUrl("ETCBC4", "Genesis", 1, {
        mode: "gramatica",
        verseRange: { from: 2, to: 4 },
        transliteration: true,
        grammar: true,
        gloss: true,
        ai: true,
        generate: true,
      }),
    ).toBe(
      "/read/ETCBC4/Genesis/1/explain?translit=1&grammar=1&gloss=1&ai=1&mode=gramatica&from=2&to=4&generate=1",
    );
  });

  it("uses a single from parameter for a one-verse range", () => {
    expect(
      explainUrl("ETCBC4", "Genesis", 1, {
        mode: "resumen",
        verseRange: { from: 5, to: 5 },
      }),
    ).toBe("/read/ETCBC4/Genesis/1/explain?mode=resumen&from=5");
  });

  it("encodes corpus and book identifiers", () => {
    expect(explainUrl("a b", "c/d", 2, { mode: "explicacion" })).toBe(
      "/read/a%20b/c%2Fd/2/explain?mode=explicacion",
    );
  });
});
