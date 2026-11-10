import { scriptClass } from "./scripts";

interface CorpusCopy {
  text: string;
  lang: string;
  reference: string;
  description: string;
}

const CORPORA_COPY: Record<string, CorpusCopy> = {
  ETCBC4: {
    text: "בְּרֵאשִׁית",
    lang: "he",
    reference: "Génesis 1:1",
    description:
      "Biblia hebrea con vocalización y acentos. Morfología, frases, cláusulas y oraciones anotadas para leer el texto en su estructura.",
  },
  nestle1904: {
    text: "Βίβλος γενέσεως",
    lang: "grc",
    reference: "Mateo 1:1",
    description:
      "Nuevo Testamento griego según Nestlé 1904. Lemas, análisis morfológico y glosas en español para cada palabra.",
  },
  jvulgate: {
    text: "Liber generationis",
    lang: "la",
    reference: "Mateo 1:1",
    description:
      "Vulgata latina de Jerónimo. El texto de la tradición occidental con morfología y glosas para seguir su lectura.",
  },
};

export function corpusCopy(corpusId: string) {
  const copy = CORPORA_COPY[corpusId];
  if (!copy) {
    return null;
  }
  return {
    ...copy,
    className: scriptClass(copy.lang),
  };
}

export function corpusSample(corpusId: string) {
  return corpusCopy(corpusId);
}
