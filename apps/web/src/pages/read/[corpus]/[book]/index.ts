import { NotFoundError } from "@bibleol/contracts";
import type { APIRoute } from "astro";
import { getReader } from "../../../../lib/reader";
import { chapterUrl } from "../../../../lib/urls";

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

  return context.redirect(
    chapterUrl(corpusId, bookId, 1, { transliteration, grammar }),
    302,
  );
};
