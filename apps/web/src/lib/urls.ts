function segment(value: string): string {
  return encodeURIComponent(value);
}

export interface ChapterUrlOptions {
  transliteration?: boolean;
}

export function chapterUrl(
  corpusId: string,
  bookId: string,
  chapter: number,
  options: ChapterUrlOptions = {},
): string {
  const path = `/read/${segment(corpusId)}/${segment(bookId)}/${chapter}`;
  return options.transliteration ? `${path}?translit=1` : path;
}

export function corpusUrl(corpusId: string, bookId: string): string {
  return `/read/${segment(corpusId)}/${segment(bookId)}`;
}
