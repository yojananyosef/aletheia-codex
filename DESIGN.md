# Design

BibleOL looks like a critical edition, not a dashboard. The page is set like a
book: generous margins, a serif voice, restrained rules and one strong accent.
The interface recedes so the original script can lead.

## Principles

1. **One system.** Every surface uses the same tokens, radii, type scale and
   spacing. There are no one-off colours or card styles.
2. **Typography carries the hierarchy.** Display serif for titles and references,
   UI sans for controls and metadata, specialist serif for the biblical text.
3. **Paper, not glass.** Flat surfaces, hairline borders and small radii. No
   gradients, glassmorphism or floating chrome.
4. **One dark surface.** The AI band is the only large dark block. It marks a
   change of mode: from reading to assisted study.
5. **Quiet motion.** Short fades and 1–2 px lifts. Nothing bounces. A spinner
   may loop only while work is in progress. Reduced-motion preferences are
   respected.
6. **The apparatus is a layer.** A word opens one compact preview, never a
   second pinned copy. On wide screens it docks in a reserved side column, so it
   never covers the verse being studied; on touch it becomes a bottom sheet.

## Typography

| Role      | Family                 | Use                                            |
| --------- | ---------------------- | ---------------------------------------------- |
| Display   | Newsreader Variable    | Hero, page titles, edition names, references   |
| UI        | IBM Plex Sans Variable | Navigation, labels, buttons, metadata, glosses |
| Reading   | Gentium Plus           | Greek and Latin text, AI answers               |
| Hebrew    | Ezra SIL               | Hebrew text with vocalisation and accents      |
| Translit. | Doulos SIL             | Transliteration under Hebrew/Greek words       |

Newsreader is set with tight tracking (`-0.03em` to `-0.045em`) and weights
400–600. Titles are sentence case. Metadata is uppercase IBM Plex at 0.56–0.7 rem
with wide tracking. Reading sizes are script-specific: Hebrew is larger and
looser than Greek or Latin because of its diacritics.

Self-hosted font files live in `apps/web/public/fonts`; the variable UI and
display families come from Fontsource. No external font requests are made on
reading pages.

## Palette

Light mode:

| Token            | Value     | Role                                  |
| ---------------- | --------- | ------------------------------------- |
| `--background`   | `#f4f5f2` | Cool paper page                       |
| `--foreground`   | `#171a1f` | Ink                                   |
| `--card`         | `#ffffff` | Raised paper, controls                |
| `--paper`        | `#fbfbf9` | Reading sheet                         |
| `--brand`        | `#1f44c7` | Ultramarine accent                    |
| `--brand-strong` | `#16349b` | Hover/active accent                   |
| `--brand-soft`   | `#e8edfb` | Selection, active toggles, word hover |
| `--border`       | `#d9dde5` | Hairlines                             |
| `--muted`        | `#5d6675` | Secondary text                        |
| `--destructive`  | `#b42318` | Errors                                |
| `--ai-bg`        | `#151922` | AI band                               |
| `--ai-accent`    | `#a9b8ff` | AI eyebrow and icons                  |

Edition accents:

| Edition | Light     | Role                         |
| ------- | --------- | ---------------------------- |
| Hebrew  | `#1f44c7` | Tabs, reading rules, markers |
| Greek   | `#0f766e` | Tabs and edition marker      |
| Latin   | `#9f1239` | Tabs and edition marker      |

Dark mode maps the same semantic tokens to a blue-black paper (`#111318`),
lighter ink and brighter accents. It follows `prefers-color-scheme`; there is no
theme switch. The AI band stays dark in both modes.

The reading page derives `--reading-accent` from `data-edition`, so tabs, the
running-head rule, chapter number and the sheet's top border carry the edition
colour. The homepage edition rows use the same mapping.

## Layout

- Global wrap: `78rem`; reading wrap: `72rem`; AI page: `60rem`.
- Base radius: `6px`; cards use `10px`; pills use `999px`.
- Hairline borders are 1 px. The reading sheet has a 3 px edition-coloured top
  border and a 10 px radius.
- Vertical rhythm is generous: section padding 4–7 rem, reading header 2.6 rem,
  verse padding 0.7–0.9 rem.
- The homepage hero fills the viewport at ≥941 px and centres its two-column
  grid (copy + specimen card).
- Edition rows are three columns on desktop: specimen, copy, form. They collapse
  to stacked cards on narrow screens.

Breakpoints:

- `1200px` — compact edition tabs, smaller reading type.
- `940px` — single-column AI band, tighter chapter controls.
- `760px` — chapter navigation wraps into two rows; jump form becomes a full
  row; empty previous/next slots disappear.
- `560px` — single-column tools, larger touch targets, reduced verse gutters.

## Components

The UI kit is Astro-native, not React. Components live in
`apps/web/src/components/ui/` and use `cn()` (`clsx` + `tailwind-merge`).

- `Button` — variants `default`, `secondary`, `outline`, `ghost`,
  `destructive`, `link`, `inverse`; sizes `default`, `sm`, `lg`, `icon`.
  Renders `<a>` when `href` is present, otherwise `<button>`.
- `Badge` — metadata and edition identifiers.
- `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`,
  `CardFooter` — composable surfaces.
- `Input`, `Select`, `Label`, `Field` — form primitives with visible labels.
- `RadioGroup`, `RadioGroupItem` — labelled radio cards with an optional hint.
- `Alert` — notices and errors.
- `Spinner`, `Skeleton` — loading feedback for work that takes time.
- `Separator`, `Toggle` — layout and state helpers.
- `Icon` — inline SVG set (no icon font, no runtime dependency).

Tailwind utilities are used inside the kit. Page-level composition uses the
semantic classes in `global.css`, `reading.css` and `ai.css`, which are the
source of truth for layout and long-form styling. Legacy class names used by the
static exporter and the e2e suite are preserved.

The dense chapter toolbar keeps native `select`/`number` controls: its compact
geometry and the form markup rewritten by `static-reading.js` are easier to keep
stable that way. Full-size forms, such as the AI request form, use the kit's
`Input`, `Select`, `Field`, `RadioGroup` and `Button`.

## Page patterns

### Home

1. **Hero** — eyebrow with a short rule, large display headline, one primary
   action and one quiet sample link, four facts, and a specimen card showing
   Genesis 1:1 / Matthew 1:1 in the three editions.
2. **Editions** — numbered editorial rows with script specimen, description,
   counts, sample link and a complete no-JS chapter form.
3. **Features** — three numbered columns explaining morphology, scripts and the
   no-JavaScript contract.
4. **AI band** — dark, two columns: invitation and CTA on the left, three modes
   on the right. Hidden entirely when AI is unavailable.

### Reading

1. Edition tabs across the top, with compact labels below 1200 px.
2. Running head: edition kicker, large book title, chapter number in the edition
   colour, edition/verse-count metadata.
3. Compact chapter toolbar: previous/next steps and a book/chapter/range jump
   form. The range fields disappear at 940 px and return on mobile.
4. Tools row: one-line hint plus quiet pills for grammar, transliteration,
   gloss and the AI shortcut.
5. Paper sheet with hanging verse numbers and edition-coloured top rule.
   Gloss mode uses a stable 8 rem cell so words do not jump when glosses appear.
6. Word tokens are focusable `<span class="word__trigger">` elements. On devices
   with a precise pointer, hover or `:focus-visible` previews a compact panel in
   a reserved side column, kept beside the text with CSS anchor positioning.
   Clicking never pins a second copy: leaving the word dismisses the preview.
   Touch uses `:focus-within` and shows the same card as a bottom sheet. The
   compact card omits the long lexeme statistics; form, morphology and glosses
   remain.
7. Grammar view replaces the sheet with nested syntax boxes, coloured by level
   and mirrored for RTL.
8. AI panel sits after the text, before the back-to-top link.

### Explain

Calm form page: back link, display title, intro, mode cards, optional verse
range, submit button and a wait note. Results use a paper answer sheet with
metadata and quota line. Errors use the destructive alert treatment and offer a
retry only for provider/server failures.

While a request is running, a fixed dark toast with a spinner, a short message
and skeleton lines announces progress; the submit button is disabled and swaps
its icon for a spinner. The form itself is still a plain GET form and works
without JavaScript.

### 404

Keeps the exact strings and raw `.button.button--primary` markup required by
`scripts/export-static.mjs`: `<p class="eyebrow">404</p>`, the
`No encontramos ese pasaje` heading, the `.not-found__text` paragraph and the
`Volver a la selección` primary link. It is intentionally not migrated to the
`Button` component because the exporter rewrites that exact string.

## Motion

- Page-load reveal: short opacity/translate fade on hero and main sections.
- Hover: colour and border transitions at 140–160 ms; AI mode cards lift 1 px.
- Back-to-top uses a scroll-driven reveal where supported, with a keyframe
  fallback and a reduced-motion variant.
- Spinners rotate only while a word panel or an AI answer is loading; the
  static-reading panel spinner is CSS-only.
- No autoplay, parallax or decorative looping animation.

## Accessibility

- Skip link to `#main`; visible `:focus-visible` rings on all controls.
- Semantic landmarks, one `h1` per page, labelled forms and fieldsets.
- RTL is handled with `dir` and grid column swaps, not transforms.
- Colour is never the only signal: active toggles also change label and border.
- Touch targets are at least ~36 px; mobile controls grow to ~42 px.
- Word triggers are in the tab order; the preview is described with
  `aria-describedby` and the panel itself uses `tabindex="-1"` so keyboard users
  tab from word to word, not through every card. The touch sheet stays open when
  it is tapped and closes when focus leaves the word.
- Reading and word lookup work with JavaScript disabled.
- AI progress is announced through a `role="status"` live region and the submit
  button exposes `aria-busy` while it is disabled.
- Print hides navigation, tools and AI; verses avoid page breaks.

## Voice and copy

Spanish, direct and literate. Sentence case. No exclamation marks, no hype, no
"potencia tu estudio". Prefer _edición_, _corpus_, _pasaje_, _capítulo_,
_versículo_, _glosa_, _lexema_ and _morfología_. Avoid anglicisms where a natural
Spanish word exists (`Alfabetos`, not `Scripts`). Buttons are verbs: _Leer_,
_Ir_, _Elegir una edición_, _Probar el asistente_. Metadata is terse; prose is
reserved for intros and explanations.

The brand is written `BibleOL`, with `OL` in the accent colour. Edition IDs
(`ETCBC4`, `nestle1904`, `jvulgate`) are technical identifiers and stay as-is.

## Constraints

- Do not add `<script>` or external resources to the chapter page.
- Preserve e2e selectors and exact strings, including `Lea la Biblia en sus
lenguas originales`, `Abrir Mateo 1`, `Mostrar gramática`, `Ir`, `Leer`,
  `.corpus-card`, `.corpus-tab__short`, `.corpus-tab__title`, `.chapter-nav`,
  `.chapter-step--next`, `.chapter-step--empty`, `.verse`, `.word__trigger`,
  `.word__panel`, `[data-word-panel]`, `.grammar` and
  `.grammar-legend__item`.
- Keep the 404 markup intact for the static exporter.
- Static reading pages remove the word panels from the HTML and load them from
  the gzipped map on `pointerover`/`focusin`; `data-word-panel` is the extraction
  marker.
- `STATIC_EXPORT=1` must continue to hide the AI panel and route.
- New colours, spacing or radii belong in tokens first, then components.

## Files

- `apps/web/src/styles/global.css` — tokens, base, header/footer, home, 404,
  shared utilities.
- `apps/web/src/styles/reading.css` — tabs, running head, chapter toolbar,
  tools, verses, word panels, grammar, print, reading breakpoints.
- `apps/web/src/styles/ai.css` — AI band, explain form, answer sheet, notices.
- `apps/web/src/components/ui/` — Astro shadcn-style kit.
- `apps/web/src/pages/index.astro` — home composition.
- `apps/web/src/pages/read/[corpus]/[book]/[chapter].astro` — reader.
- `apps/web/src/pages/read/[corpus]/[book]/[chapter]/explain.astro` — AI page.
- `apps/web/src/features/` — navigation, reading and AI feature components.
- `apps/web/public/static-reading.js` — on-demand word panels and view state for
  the static snapshot.
- `apps/web/public/static-reading.css` — static layout, panel fallback and
  loading spinner.
