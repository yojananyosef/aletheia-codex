# Product

Aletheia Codex is a Spanish-language reading environment for the Bible in its original
languages. It presents the Hebrew, Greek and Latin text with the linguistic
apparatus needed to study it: transliteration, lemmas, morphology, Spanish
glosses and syntax trees.

The product is a reading tool, not a commentary or a devotional app. The text is
the centre of the page; everything else is available on demand.

## Users and jobs

- **Students of the biblical languages** read a chapter and inspect a word
  without losing their place in the text.
- **Teachers and pastors** prepare a passage with the original text and its
  structure in front of them.
- **Curious readers** compare the same beginning across the three editions and
  read Spanish glosses when the original script is unfamiliar.

The primary job is: open a chapter, read it, and look up a word or a clause
without navigating away.

## Product principles

1. **The text comes first.** The original script is the largest element on the
   reading page. Chrome, controls and apparatus stay quiet.
2. **Reading works without JavaScript.** Every chapter is complete HTML from the
   server. Toggles are links; word details are focusable spans that preview on
   hover or keyboard focus, and become a bottom sheet on touch. Clicking a word
   never pins a duplicate panel. No script is required to read, navigate or
   inspect a word.
3. **One chapter, one page.** Reading, transliteration, glosses, grammar and the
   AI invitation live on the same canonical URL. State is carried in query
   parameters so it survives reloads and can be shared.
4. **The apparatus is optional.** Transliteration, glosses and grammar are
   opt-in views. The default page is the clean original text.
5. **AI is separate and optional.** The assistant is an invitation below the
   text, never an overlay or an interruption. It is disabled when no provider is
   configured and is absent from the static export.
6. **The static export is a fallback, not a second product.** It preserves
   reading and word lookup for GitHub Pages, without AI and without server
   routes.

## Corpora

| ID           | Edition                   | Language | Direction | Extras                       |
| ------------ | ------------------------- | -------- | --------- | ---------------------------- |
| `ETCBC4`     | Biblia hebraica (ETCBC4)  | Hebrew   | RTL       | Transliteration, gloss, tree |
| `nestle1904` | Nuevo Testamento (Nestlé) | Greek    | LTR       | Gloss, tree                  |
| `jvulgate`   | Vulgata latina            | Latin    | LTR       | Gloss, tree                  |

Counts and book lists are read from the local SQLite corpus at request time and
must not be hard-coded in copy.

## Routes

- `/` — edition selection, sample links and the three chapter forms.
- `/read/:corpus/:book/:chapter` — chapter reader.
- `/read/:corpus/:book/:chapter/explain` — AI form and answer page.
- `/read?corpus=…&book=…&chapter=…` — redirect to the canonical reading URL.
- `/404` — not-found page, also used by rewrites and the static exporter.

Reading query parameters:

- `translit=1` — show transliteration where available.
- `gloss=1` — show Spanish glosses under each word.
- `grammar=1` — show the syntax view instead of running text.
- `from`, `to` — restrict the chapter to a verse range. Reversed values are
  normalised and clamped to the last real verse.

Toggles and chapter navigation preserve the active view and range. Changing
book, corpus or chapter resets the range and shows the whole chapter.

## AI study assistant

- Modes: `resumen`, `explicacion`, `gramatica`.
- Primary model: `google/gemma-4-31b-it:free`.
- Fallback model: `nvidia/nemotron-3.5-lightning:free`.
- Last resort: `nvidia/nemotron-3-ultra-550b-a55b:free`.
- Free endpoints are shared and can be rate-limited upstream. The fallback chain
  is part of the product contract, not a deployment detail.
- The request uses the selected passage, the corpus morphology and the active
  reading options. Answers are plain text, rendered as text, never as HTML.
- Per-user limits, exact-passage cache and Redis/SQLite storage are enforced by
  the server. Cached answers do not consume quota.
- The form is a normal GET form and works without JavaScript. A generation can
  take a while; a fixed progress toast, a spinner and a disabled submit button
  make the wait visible when JavaScript is available, and the page explains the
  wait either way.
- `AI_ENABLED=1` plus `OPENROUTER_API_KEY` enables the feature. Without both,
  the panel and route are absent (404).
- `STATIC_EXPORT=1` always hides the assistant and makes `/explain` a 404.

## Deployment

- **Primary:** full SSR container on Vercel (`vercel.json`, `Dockerfile`).
  Includes the corpora, AI routes, caching and quotas.
- **Fallback:** static snapshot for GitHub Pages via
  `pnpm export:static`. It crawls the SSR output, rewrites links for a base path,
  removes the word panels from each page and loads them on demand from gzipped
  JSON maps through `static-reading.js`.
- The GitHub Pages snapshot is frozen and is not the production target.

## Non-goals

- User accounts, saved notes or cross-device sync.
- Full-text search or cross-reference tools.
- A JavaScript-only reader, client-side routing or a SPA shell.
- Exposing the AI assistant in the static export.
- Presenting AI output as authoritative commentary. The UI labels it as a study
  aid and keeps the text visible.

## Quality contract

- The reading page must contain no `<script>` and no external `http(s)`
  resources.
- E2E tests run with JavaScript disabled and depend on exact Spanish strings and
  class names such as `.corpus-card`, `.chapter-nav`, `.verse`, `.word__trigger`,
  `.word__panel`, `.grammar` and `.grammar-legend__item`.
- The static exporter depends on the exact 404 markup, on the `.grammar`
  fragment, and on `data-word-panel` as the marker for extracting word panels.
- The interface is Spanish. Corpora names, edition identifiers and the brand
  name are proper nouns and stay unchanged.

## Running it

```sh
pnpm install
pnpm data:sync
pnpm dev            # http://localhost:4321
pnpm check
pnpm test
pnpm build
pnpm test:e2e
```
