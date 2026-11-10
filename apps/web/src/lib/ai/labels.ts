import type { AiMode } from "./types";

const MODEL_LABELS: Record<string, string> = {
  "google/gemma-4-31b-it:free": "Gemma 4 31B (gratuito)",
  "google/gemma-4-31b-it": "Gemma 4 31B",
  "nvidia/nemotron-3.5-lightning:free": "Nemotron 3.5 Lightning (gratuito)",
  "nvidia/nemotron-3.5-lightning": "Nemotron 3.5 Lightning",
  "nvidia/nemotron-3-ultra-550b-a55b:free": "Nemotron 3 Ultra (gratuito)",
  "nvidia/nemotron-3-ultra-550b-a55b": "Nemotron 3 Ultra",
};

export function modelLabel(model: string): string {
  return MODEL_LABELS[model] ?? model;
}

export interface ModeCopy {
  label: string;
  hint: string;
}

const MODE_COPY: Record<AiMode, ModeCopy> = {
  resumen: {
    label: "Resumen",
    hint: "Síntesis del pasaje, puntos clave y contexto literario.",
  },
  explicacion: {
    label: "Explicación",
    hint: "Sentido del texto por unidades literarias, con ambigüedades y preguntas de estudio.",
  },
  gramatica: {
    label: "Gramática",
    hint: "Oraciones, cláusulas y frases, con la morfología relevante.",
  },
};

export function modeCopy(mode: AiMode): ModeCopy {
  return MODE_COPY[mode];
}
