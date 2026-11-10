import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const CATALOGUE_SEGMENTS = ["data", "metadata", "corpora.json"];

function findDataDir(start: string): string | null {
  let directory = resolve(start);
  for (;;) {
    if (existsSync(join(directory, ...CATALOGUE_SEGMENTS))) {
      return join(directory, "data");
    }
    const parent = dirname(directory);
    if (parent === directory) {
      return null;
    }
    directory = parent;
  }
}

export interface DataPaths {
  dataDir: string;
  cataloguePath: string;
  corporaDir: string;
  lexiconDir: string;
}

export function getDataPaths(): DataPaths {
  const override = process.env.BIBLEOL_DATA_DIR;
  const dataDir = override ? resolve(override) : findDataDir(process.cwd());

  if (!dataDir) {
    throw new Error(
      "No se encontró data/metadata/corpora.json. Defina BIBLEOL_DATA_DIR o ejecute la aplicación desde el repositorio.",
    );
  }

  return {
    dataDir,
    cataloguePath: join(dataDir, "metadata", "corpora.json"),
    corporaDir: join(dataDir, "corpora"),
    lexiconDir: join(dataDir, "lexicon"),
  };
}
