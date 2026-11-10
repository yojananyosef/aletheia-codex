export const AI_MODES = ["resumen", "explicacion", "gramatica"] as const;

export type AiMode = (typeof AI_MODES)[number];

export function parseAiMode(value: string | null | undefined): AiMode {
  if (value === "resumen" || value === "explicacion" || value === "gramatica") {
    return value;
  }
  return "explicacion";
}

export interface AiResult {
  text: string;
  model: string;
  cached: boolean;
  createdAt: number;
  remaining: number | null;
  usage: AiUsage | null;
  from: number;
  to: number;
  verses: number;
  mode: AiMode;
}

export interface AiUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  cost: number | null;
}
