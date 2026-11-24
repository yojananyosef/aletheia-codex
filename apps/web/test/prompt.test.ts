import type { CorpusSummary, GrammarObject, Verse } from "@aletheia-codex/contracts";
import { describe, expect, it } from "vitest";
import { buildPrompt } from "../src/lib/ai/prompt";

const corpus: CorpusSummary = {
  id: "ETCBC4",
  name: "ETCBC4",
  title: "Biblia hebrea",
  version: "24",
  language: "he",
  languageName: "hebreo",
  direction: "rtl",
  hasTransliteration: true,
  groups: [],
  levels: [],
  gloss: null,
  books: [],
};

const verse: Verse = {
  number: 1,
  label: "Genesis 1:1",
  words: [
    {
      monad: 1,
      verse: 1,
      text: "בְּרֵאשִׁית",
      transliteration: "bᵊrēʾšît",
      lemma: "רֵאשִׁית",
      lexemeVariant: "רֵאשִׁית",
      gloss: { text: "principio", language: "es" },
      features: [
        {
          key: "sp",
          label: "Parte del discurso",
          kind: "enum",
          value: "prep",
          enumName: "part_of_speech_t",
        },
        {
          key: "lexeme_occurrences",
          label: "Ocurrencias",
          kind: "number",
          value: "5",
          enumName: null,
        },
      ],
    },
  ],
};

const verses: Verse[] = [verse];

const grammar: GrammarObject[] = [
  {
    id: "sentence:1",
    level: "sentence",
    label: "Oración",
    firstMonad: 1,
    lastMonad: 5,
    verseStart: 1,
    verseEnd: 1,
    features: [],
    parentId: null,
    depth: 0,
  },
];

describe("buildPrompt", () => {
  it("includes the corpus text, morphology, gloss and grammar", () => {
    const prompt = buildPrompt({
      corpus,
      bookLabel: "Génesis",
      chapter: 1,
      verses,
      grammar,
      mode: "resumen",
    });

    expect(prompt.user).toContain("Referencia: Génesis 1:1");
    expect(prompt.user).toContain("בְּרֵאשִׁית");
    expect(prompt.user).toContain("bᵊrēʾšît");
    expect(prompt.user).toContain("Parte del discurso: preposición");
    expect(prompt.user).toContain("glosa=principio");
    expect(prompt.user).toContain("[sentence] Oración (v. 1)");
    expect(prompt.user).toContain("TAREA: escribe un resumen");
    expect(prompt.user).not.toContain("Ocurrencias");
    expect(prompt.system).toContain("No des asesoramiento legal");
  });

  it("changes the instructions for each mode", () => {
    const summary = buildPrompt({
      corpus,
      bookLabel: "Génesis",
      chapter: 1,
      verses,
      grammar,
      mode: "resumen",
    });
    const grammarPrompt = buildPrompt({
      corpus,
      bookLabel: "Génesis",
      chapter: 1,
      verses,
      grammar,
      mode: "gramatica",
    });

    expect(summary.user).toContain("TAREA: escribe un resumen");
    expect(grammarPrompt.user).toContain(
      "TAREA: analiza la estructura gramatical",
    );
    expect(grammarPrompt.user).toContain("Modo solicitado: gramatica");
  });

  it("uses the verse range in the reference", () => {
    const prompt = buildPrompt({
      corpus,
      bookLabel: "Génesis",
      chapter: 1,
      verses: [
        { ...verse, number: 2 },
        { ...verse, number: 4 },
      ],
      grammar,
      mode: "explicacion",
    });

    expect(prompt.user).toContain("Referencia: Génesis 1:2–4");
    expect(prompt.user).toContain("Versículos incluidos: 2");
  });
});
