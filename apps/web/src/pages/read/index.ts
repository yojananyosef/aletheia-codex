import { NotFoundError } from "@aletheia-codex/contracts";
import type { APIRoute } from "astro";
import { getReader } from "../../lib/reader";
import { chapterUrl } from "../../lib/urls";
import { requestedVerseRange } from "../../lib/verse-range";

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
  const grammar = params.get("grammar") === "1";
  const gloss = params.get("gloss") === "1" && corpus.gloss !== null;
  const ai = params.get("ai") === "1";
  const verseRange = requestedVerseRange(params);

  return context.redirect(
    chapterUrl(corpus.id, bookId, chapter, {
      transliteration,
      grammar,
      gloss,
      ai,
      verseRange,
    }),
    302,
  );
};
