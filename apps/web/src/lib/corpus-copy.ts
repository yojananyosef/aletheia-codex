import { scriptClass } from "./scripts";

const SAMPLES: Record<string, { text: string; lang: string }> = {
  ETCBC4: { text: "בְּרֵאשִׁית", lang: "he" },
  nestle1904: { text: "Ἐν ἀρχῇ", lang: "grc" },
  jvulgate: { text: "In principio", lang: "la" },
};

export function corpusSample(corpusId: string) {
  const sample = SAMPLES[corpusId];
  if (!sample) {
    return null;
  }
  return {
    ...sample,
    className: scriptClass(sample.lang),
  };
}
