import type {
  CorpusSummary,
  GrammarObject,
  Verse,
  Word,
} from "@aletheia-codex/contracts";
import { featureValueLabel } from "../grammar-labels";
import type { AiMode } from "./types";

export const AI_PROMPT_VERSION = 1;

export interface PromptInput {
  corpus: CorpusSummary;
  bookLabel: string;
  chapter: number;
  verses: Verse[];
  grammar: GrammarObject[];
  mode: AiMode;
}

export interface Prompt {
  system: string;
  user: string;
}

const CORE_FEATURE_KEYS = new Set([
  "sp",
  "psp",
  "vs",
  "vt",
  "st",
  "ps",
  "gn",
  "nu",
  "case",
  "tense",
  "voice",
  "mood",
  "degree",
  "declension",
  "conjugation",
  "stem",
  "suffix",
  "lexical_set",
  "verb_class",
]);

const SKIP_FEATURE_KEYS = new Set([
  "lexeme_occurrences",
  "frequency_rank",
  "g_lex_utf8",
  "g_vbs_utf8",
  "g_pfm_utf8",
  "g_vbe_utf8",
  "g_nme_utf8",
  "g_prs_utf8",
  "g_uvf_utf8",
  "qere_utf8",
  "g_voc_lex_translit",
  "lex",
]);

const GRAMMAR_LEVEL_KEYS = new Set([
  "sentence",
  "clause",
  "clause1",
  "clause2",
  "phrase",
]);

const SYSTEM_PROMPT = `Eres un asistente de estudio bíblico de Aletheia Codex, una aplicación de lectura de la Biblia en lenguas originales.

Tu tarea es ayudar a comprender un pasaje a partir del texto original, la transliteración, las glosas en español y la morfología anotada del corpus. No eres una autoridad doctrinal ni un oráculo: eres una herramienta de estudio.

Reglas:
- Responde siempre en español claro y académico.
- Distingue explícitamente entre (1) lo que dicen el texto y la morfología anotada, (2) lo que aportan las glosas y la estructura gramatical, y (3) tu síntesis o interpretación.
- No inventes formas hebreas, griegas o latinas, ni datos morfológicos. Si el corpus no ofrece un dato, dilo.
- Cuando cites una palabra original, copia la forma del corpus y añade su transliteración si está disponible.
- Si hay ambigüedad gramatical o lexical, señálala en lugar de resolverla dogmáticamente.
- No presentes una lectura confesional concreta como el único sentido del texto.
- No des asesoramiento legal, médico, financiero ni de seguridad.
- No muestres tu cadena de razonamiento interna. Entrega solo la respuesta final.
- Usa texto plano: encabezados en mayúsculas, viñetas con "- " y párrafos separados por una línea en blanco. No uses tablas, HTML ni bloques de código.`;

function formatFeature(feature: Word["features"][number]): string {
  return `${feature.label}: ${featureValueLabel(feature)}`;
}

function formatWord(word: Word, mode: AiMode): string {
  const parts: string[] = [word.text];

  if (word.transliteration) {
    parts.push(`(${word.transliteration})`);
  }

  const lemma = word.lexemeVariant ?? word.lemma;
  if (lemma && lemma !== word.text) {
    parts.push(`lexema=${lemma}`);
  }

  const features = word.features.filter((feature) => {
    if (SKIP_FEATURE_KEYS.has(feature.key)) {
      return false;
    }
    return mode === "gramatica" || CORE_FEATURE_KEYS.has(feature.key);
  });
  if (features.length > 0) {
    parts.push(`[${features.map(formatFeature).join("; ")}]`);
  }

  if (word.gloss) {
    parts.push(`glosa=${word.gloss.text}`);
  }

  return parts.join(" ");
}

function formatGrammar(grammar: GrammarObject[], verses: Verse[]): string[] {
  const first = verses[0]?.number;
  const last = verses[verses.length - 1]?.number;
  if (first === undefined || last === undefined) {
    return [];
  }

  return grammar
    .filter(
      (object) =>
        GRAMMAR_LEVEL_KEYS.has(object.level) &&
        object.verseEnd >= first &&
        object.verseStart <= last,
    )
    .map((object) => {
      const indent = "  ".repeat(Math.min(object.depth, 6));
      const range =
        object.verseStart === object.verseEnd
          ? `v. ${object.verseStart}`
          : `vv. ${object.verseStart}–${object.verseEnd}`;
      const features = object.features
        .filter((feature) => !SKIP_FEATURE_KEYS.has(feature.key))
        .map(formatFeature)
        .join("; ");
      return `${indent}- [${object.level}] ${object.label} (${range})${
        features ? ` — ${features}` : ""
      }`;
    });
}

function modeInstructions(mode: AiMode): string {
  if (mode === "resumen") {
    return `TAREA: escribe un resumen del pasaje.
- Empieza con una síntesis de 2 o 3 párrafos.
- Después incluye 3 a 5 puntos clave, cada uno con su referencia de versículo.
- Añade un breve contexto literario o narrativo solo cuando ayude a entender el pasaje.
- No hagas un análisis morfológico exhaustivo.
- Extensión orientativa: 300 a 500 palabras.`;
  }

  if (mode === "gramatica") {
    return `TAREA: analiza la estructura gramatical del pasaje.
- Recorre las unidades principales (oraciones, cláusulas y frases) en orden.
- Explica las funciones sintácticas y la morfología relevante de las formas principales.
- Señala conectores, sujetos, predicados, objetos y relaciones entre cláusulas.
- Distingue la morfología anotada de tu interpretación sintáctica.
- No conviertas el análisis en una predicación.
- Extensión orientativa: 500 a 900 palabras.`;
  }

  return `TAREA: explica el sentido del pasaje.
- Organiza la explicación por unidades literarias o por versículos, no palabra por palabra.
- Identifica sujetos, acciones, conectores, paralelismos, repeticiones y términos clave.
- Usa las glosas y la morfología para apoyar la explicación, pero no las repitas mecánicamente.
- Señala las ambigüedades y las decisiones interpretativas.
- Termina con 2 o 3 preguntas de estudio.
- Extensión orientativa: 500 a 800 palabras.`;
}

export function buildPrompt(input: PromptInput): Prompt {
  const { corpus, bookLabel, chapter, verses, grammar, mode } = input;
  const first = verses[0]?.number;
  const last = verses[verses.length - 1]?.number;
  const reference =
    first === undefined || last === undefined
      ? `${bookLabel} ${chapter}`
      : first === last
        ? `${bookLabel} ${chapter}:${first}`
        : `${bookLabel} ${chapter}:${first}–${last}`;

  const verseBlocks = verses.map((verse) => {
    const words =
      verse.words.length > 0
        ? verse.words.map((word) => formatWord(word, mode)).join(" · ")
        : "(sin palabras anotadas)";
    return `[${chapter}:${verse.number}]\n${words}`;
  });

  const grammarLines = formatGrammar(grammar, verses);
  const version = corpus.version ? ` ${corpus.version}` : "";
  const languageName = corpus.languageName;
  const direction =
    corpus.direction === "rtl"
      ? "de derecha a izquierda"
      : "de izquierda a derecha";

  const user = `PASAJE
Referencia: ${reference}
Corpus: ${corpus.title} (${corpus.id}${version})
Idioma del texto: ${languageName} (${corpus.language}), ${direction}
Modo solicitado: ${mode}
Versículos incluidos: ${verses.length}

${modeInstructions(mode)}

DATOS DEL CORPUS
Cada línea de palabra sigue este orden cuando el dato existe: forma original, transliteración entre paréntesis, lexema, rasgos morfológicos entre corchetes y glosa en español.

${verseBlocks.join("\n\n")}

ESTRUCTURA GRAMATICAL
${grammarLines.length > 0 ? grammarLines.join("\n") : "(sin estructura gramatical anotada)"}

INSTRUCCIONES DE SALIDA
- Escribe en español.
- Cita los versículos como ${chapter}:${first ?? 1} o ${chapter}:${last ?? 1}.
- No repitas todo el texto original: selecciona solo las formas que expliques.
- Si una glosa es ambigua o contradictoria, dilo expresamente.
- Termina con una sección "PARA VERIFICAR" con 2 o 3 comprobaciones concretas en el texto o en la morfología.
- No incluyas razonamiento interno, notas de proceso ni instrucciones para el usuario.`;

  return { system: SYSTEM_PROMPT, user };
}
