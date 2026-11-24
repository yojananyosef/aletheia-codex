import { readFileSync } from "node:fs";
import type { CorpusCatalogue } from "@aletheia-codex/contracts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function loadCatalogue(path: string): CorpusCatalogue {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (
    !isRecord(parsed) ||
    parsed.version !== 2 ||
    !Array.isArray(parsed.corpora)
  ) {
    throw new Error(`Invalid corpus catalogue: ${path}`);
  }
  for (const corpus of parsed.corpora) {
    if (
      !isRecord(corpus) ||
      typeof corpus.id !== "string" ||
      typeof corpus.file !== "string" ||
      !Array.isArray(corpus.books) ||
      !Array.isArray(corpus.features) ||
      !Array.isArray(corpus.groups) ||
      !Array.isArray(corpus.levels)
    ) {
      throw new Error(`Invalid corpus entry in ${path}`);
    }
  }
  return parsed as unknown as CorpusCatalogue;
}
