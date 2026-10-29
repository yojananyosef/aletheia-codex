export type TextDirection = "ltr" | "rtl";

export interface Book {
  id: string;
  name: string;
  number: number;
  chapters: number;
}

export interface FeatureSource {
  key: string;
  table: string;
}

export interface EnumFeatureDefinition {
  key: string;
  label: string;
  kind: "enum";
  enum: string;
  values: Record<string, string>;
}

export interface StringFeatureDefinition {
  key: string;
  label: string;
  kind: "string";
  table: string;
}

export type FeatureDefinition = EnumFeatureDefinition | StringFeatureDefinition;

export interface CorpusMetadata {
  id: string;
  name: string;
  title: string;
  version: string | null;
  language: string;
  languageName: string;
  direction: TextDirection;
  charset: string | null;
  file: string;
  bytes: number;
  sha256: string;
  source: string | null;
  surface: FeatureSource;
  lemma: FeatureSource;
  transliteration: FeatureSource | null;
  features: FeatureDefinition[];
  books: Book[];
}

export interface CorpusCatalogue {
  version: number;
  generatedFrom: string;
  corpora: CorpusMetadata[];
}

export interface CorpusSummary {
  id: string;
  name: string;
  title: string;
  version: string | null;
  language: string;
  languageName: string;
  direction: TextDirection;
  hasTransliteration: boolean;
  books: Book[];
}

export interface FeatureValue {
  key: string;
  label: string;
  value: string;
  enumName: string | null;
}

export interface Word {
  monad: number;
  text: string;
  transliteration: string | null;
  lemma: string | null;
  features: FeatureValue[];
}

export interface Verse {
  number: number;
  label: string;
  words: Word[];
}

export interface Chapter {
  corpus: CorpusSummary;
  book: Book;
  chapter: number;
  verses: Verse[];
}

export class NotFoundError extends Error {
  readonly status = 404;

  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}
