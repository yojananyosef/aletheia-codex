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

export type FeatureKind = "enum" | "string" | "number" | "multi-enum";

interface BaseFeatureDefinition {
  key: string;
  label: string;
  hidden?: boolean;
}

export interface EnumFeatureDefinition extends BaseFeatureDefinition {
  kind: "enum";
  enum: string;
  values: Record<string, string>;
}

export interface MultiEnumFeatureDefinition extends BaseFeatureDefinition {
  kind: "multi-enum";
  enum: string;
  values: Record<string, string>;
}

export interface StringFeatureDefinition extends BaseFeatureDefinition {
  kind: "string";
  table: string | null;
}

export interface NumberFeatureDefinition extends BaseFeatureDefinition {
  kind: "number";
}

export type FeatureDefinition =
  | EnumFeatureDefinition
  | MultiEnumFeatureDefinition
  | StringFeatureDefinition
  | NumberFeatureDefinition;

export interface GrammarMetaFeatureDefinition {
  key: string;
  label: string;
  features: string[];
}

export interface GrammarGroupDefinition {
  key: string;
  label: string;
  features: string[];
  metaFeatures: GrammarMetaFeatureDefinition[];
}

export interface GrammarLevelDefinition {
  key: string;
  label: string;
  table: string;
  rank: number;
  color: string | null;
  features: FeatureDefinition[];
}

export type GlossStrategy = "stem" | "strongs" | "lemma-pos";

export interface GlossDefinition {
  file: string;
  languages: string[];
  strategy: GlossStrategy;
}

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
  groups: GrammarGroupDefinition[];
  levels: GrammarLevelDefinition[];
  gloss: GlossDefinition | null;
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
  groups: GrammarGroupDefinition[];
  levels: GrammarLevelDefinition[];
  gloss: GlossDefinition | null;
  books: Book[];
}

export interface FeatureValue {
  key: string;
  label: string;
  kind: FeatureKind;
  value: string;
  enumName: string | null;
}

export interface WordGloss {
  text: string;
  language: string;
}

export interface Word {
  monad: number;
  verse: number;
  text: string;
  transliteration: string | null;
  lemma: string | null;
  gloss: WordGloss | null;
  features: FeatureValue[];
}

export interface GrammarObject {
  id: string;
  level: string;
  label: string;
  firstMonad: number;
  lastMonad: number;
  verseStart: number;
  verseEnd: number;
  features: FeatureValue[];
  parentId: string | null;
  depth: number;
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
  grammar: {
    objects: GrammarObject[];
  };
}

export class NotFoundError extends Error {
  readonly status = 404;

  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}
