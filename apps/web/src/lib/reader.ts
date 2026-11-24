import { CorpusReader } from "@aletheia-codex/corpus";
import { getDataPaths } from "./data-paths";

let reader: CorpusReader | undefined;

export function getReader(): CorpusReader {
  if (!reader) {
    reader = new CorpusReader(getDataPaths());
  }
  return reader;
}
