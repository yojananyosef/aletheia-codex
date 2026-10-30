function segment(value: string): string {
  return encodeURIComponent(value);
}

export interface ChapterUrlOptions {
  transliteration?: boolean;
  grammar?: boolean;
  gloss?: boolean;
}

export function chapterUrl(
  corpusId: string,
  bookId: string,
  chapter: number,
  options: ChapterUrlOptions = {},
): string {
  const path = `/read/${segment(corpusId)}/${segment(bookId)}/${chapter}`;
  const params = new URLSearchParams();
  if (options.transliteration) {
    params.set("translit", "1");
  }
  if (options.grammar) {
    params.set("grammar", "1");
  }
  if (options.gloss) {
    params.set("gloss", "1");
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function corpusUrl(corpusId: string, bookId: string): string {
  return `/read/${segment(corpusId)}/${segment(bookId)}`;
}
