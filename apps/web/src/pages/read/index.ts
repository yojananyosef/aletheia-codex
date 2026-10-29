import { NotFoundError } from "@bibleol/contracts";
import type { APIRoute } from "astro";
import { getReader } from "../../lib/reader";
import { chapterUrl } from "../../lib/urls";

export const GET: APIRoute = (context) => {
  const reader = getReader();
  const params = context.url.searchParams;
  const corpora = reader.listCorpora();
  const fallbackCorpus = corpora[0];

  if (!fallbackCorpus) {
    return context.rewrite("/404");
  }

  const corpusId = params.get("corpus") ?? fallbackCorpus.id;
  const corpus = corpora.find((item) => item.id === corpusId);

  if (!corpus) {
    return context.rewrite("/404");
  }

  const bookId =
    params.get("book") ??
    corpus.books.find((book) => book.id === "Genesis")?.id ??
    corpus.books[0]?.id;

  if (!bookId) {
    return context.rewrite("/404");
  }

  const chapter = Number(params.get("chapter") ?? "1");

  try {
    reader.getChapter(corpus.id, bookId, chapter);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return context.rewrite("/404");
    }
    throw error;
  }

  const transliteration = params.get("translit") === "1";

  return context.redirect(
    chapterUrl(corpus.id, bookId, chapter, { transliteration }),
    302,
  );
};
