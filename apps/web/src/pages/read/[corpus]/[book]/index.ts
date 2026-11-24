import { NotFoundError } from "@aletheia-codex/contracts";
import type { APIRoute } from "astro";
import { getReader } from "../../../../lib/reader";
import { chapterUrl } from "../../../../lib/urls";
import { requestedVerseRange } from "../../../../lib/verse-range";

export const GET: APIRoute = (context) => {
  const corpusId = context.params.corpus;
  const bookId = context.params.book;

  if (!corpusId || !bookId) {
    return context.rewrite("/404");
  }

  try {
    getReader().getBook(corpusId, bookId);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return context.rewrite("/404");
    }
    throw error;
  }

  const transliteration = context.url.searchParams.get("translit") === "1";
  const grammar = context.url.searchParams.get("grammar") === "1";
  const gloss = context.url.searchParams.get("gloss") === "1";
  const ai = context.url.searchParams.get("ai") === "1";
  const verseRange = requestedVerseRange(context.url.searchParams);

  return context.redirect(
    chapterUrl(corpusId, bookId, 1, {
      transliteration,
      grammar,
      gloss,
      ai,
      verseRange,
    }),
    302,
  );
};
