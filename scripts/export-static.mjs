#!/usr/bin/env node
/**
 * Export a static, GitHub Pages friendly snapshot of the reading app.
 *
 * The regular app is an Astro SSR application backed by SQLite. GitHub Pages
 * only serves static files, so this script crawls the local SSR server and
 * splits each chapter into:
 *
 *   - a slim HTML page with the verses (no word panels),
 *   - one gzipped JSON map with the pre-rendered word panels,
 *   - one gzipped HTML fragment with the grammar view.
 *
 * The small script in apps/web/public/static-reading.js loads those pieces on
 * demand. The result stays well below the 1 GB GitHub Pages site limit while
 * preserving the same markup and styling as the server-rendered app.
 */

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { createGzip } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const webRoot = join(repoRoot, "apps", "web");
const serverEntry = join(webRoot, "dist", "server", "entry.mjs");
const clientDir = join(webRoot, "dist", "client");

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const value = process.argv[index];
  if (!value.startsWith("--")) continue;
  const [key, inline] = value.slice(2).split("=", 2);
  if (inline !== undefined) {
    args.set(key, inline);
  } else if (
    process.argv[index + 1] !== undefined &&
    !process.argv[index + 1].startsWith("--")
  ) {
    args.set(key, process.argv[index + 1]);
    index += 1;
  } else {
    args.set(key, "1");
  }
}

const base = normalizeBase(
  args.get("base") ?? process.env.PAGES_BASE_PATH ?? "",
);
const outDir = resolve(repoRoot, args.get("out") ?? "dist-static");
const startServer = args.has("start-server");
const resume = args.has("resume");
const port = Number(args.get("port") ?? process.env.EXPORT_PORT ?? 4399);
const explicitServerUrl = args.get("url") ?? process.env.EXPORT_URL;
const serverCount = explicitServerUrl
  ? 1
  : Math.max(1, Number(args.get("servers") ?? 1));
const serverUrls = Array.from({ length: serverCount }, (_, index) =>
  normalizeUrl(explicitServerUrl ?? `http://127.0.0.1:${port + index}`),
);
let serverCursor = 0;
const concurrency = Math.max(1, Number(args.get("concurrency") ?? 6));
const cataloguePath = join(repoRoot, "data", "metadata", "corpora.json");

function normalizeBase(value) {
  if (!value || value === "/") return "";
  return `/${value.replace(/^\/+|\/+$/g, "")}`;
}

function normalizeUrl(value) {
  return value.replace(/\/+$/, "");
}

function withBase(pathname) {
  return `${base}${pathname}`;
}

function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
}

function findMatchingElementEnd(html, start, tagName) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>|<\\/${tagName}\\s*>`, "gi");
  pattern.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = pattern.exec(html))) {
    if (match[0].startsWith("</")) {
      depth -= 1;
      if (depth === 0) return pattern.lastIndex;
    } else if (!match[0].endsWith("/>")) {
      depth += 1;
    }
  }
  return null;
}

const PANEL_TOKEN = /<div\b[^>]*\bdata-word-panel="(\d+)"[^>]*>/g;
const DIV_TAG = /<div\b[^>]*>|<\/div\s*>/gi;

function findDivEnd(html, start) {
  DIV_TAG.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = DIV_TAG.exec(html))) {
    if (match[0].startsWith("</")) {
      depth -= 1;
      if (depth === 0) return DIV_TAG.lastIndex;
    } else if (!match[0].endsWith("/>")) {
      depth += 1;
    }
  }
  return null;
}

function extractPanels(html) {
  const ranges = [];
  let match;
  PANEL_TOKEN.lastIndex = 0;
  while ((match = PANEL_TOKEN.exec(html))) {
    const start = match.index;
    const end = findDivEnd(html, start);
    if (end === null) {
      PANEL_TOKEN.lastIndex = start + 1;
      continue;
    }
    ranges.push({
      start,
      end,
      monad: match[1],
      markup: html.slice(start, end),
    });
    // Panels are not nested, so skip the whole block instead of rescanning it.
    PANEL_TOKEN.lastIndex = end;
  }

  const parts = [];
  let cursor = 0;
  for (const range of ranges) {
    parts.push(html.slice(cursor, range.start));
    cursor = range.end;
  }
  parts.push(html.slice(cursor));
  return { html: parts.join(""), panels: ranges };
}

function extractGrammar(html) {
  const start = html.indexOf('<div class="grammar">');
  if (start < 0) return null;
  const end = findMatchingElementEnd(html, start, "div");
  return end === null ? null : html.slice(start, end);
}

function prefixRootUrls(html) {
  if (!base) return html;
  return html
    .replace(/\b(href|src|action|poster)="\/(?!\/)/g, `$1="${base}/`)
    .replace(/\b(href|src|action|poster)='\/(?!\/)/g, `$1='${base}/`);
}

/*
 * Astro names the CSS after its content hash. The snapshot is cached across
 * deployments, so every page must point at one stable file name; otherwise a
 * one-line style change would invalidate all 1.4k pages.
 */
function useStableStyles(html) {
  return html.replace(
    /\b(href|src)=(["'])\/_astro\/[^"']+\.css\2/g,
    "$1=$2/_astro/app.css$2",
  );
}

async function installStyles(outDir) {
  const astroDir = join(outDir, "_astro");
  let entries;
  try {
    entries = await readdir(astroDir);
  } catch {
    return;
  }
  const files = entries.filter((name) => name.endsWith(".css")).sort();
  if (files.length === 0) return;
  if (files.length === 1) {
    await rename(join(astroDir, files[0]), join(astroDir, "app.css"));
    return;
  }
  const parts = [];
  for (const file of files) {
    parts.push(await readFile(join(astroDir, file), "utf8"));
  }
  await writeFile(join(astroDir, "app.css"), parts.join("\n"));
  await Promise.all(files.map((file) => rm(join(astroDir, file))));
}

function decorateChapter(html, corpusId, bookId, chapter) {
  let output = prefixRootUrls(useStableStyles(html));
  output = output.replace(
    /<html\b([^>]*)>/,
    `<html$1 class="static-reading" data-base="${escapeAttribute(base)}" data-corpus="${escapeAttribute(corpusId)}" data-book="${escapeAttribute(bookId)}" data-chapter="${chapter}">`,
  );
  output = output.replace(
    "</head>",
    `<link rel="stylesheet" href="${withBase("/static-reading.css")}">` +
      `<script>!function(){var h=document.documentElement,p=new URLSearchParams(location.search);if(p.get("translit")==="1")h.classList.add("show-translit");if(p.get("gloss")==="1")h.classList.add("show-gloss");if(p.get("grammar")==="1")h.classList.add("show-grammar")}();</script>` +
      "</head>",
  );
  output = output.replace(
    "</body>",
    `<script src="${withBase("/static-reading.js")}" defer></script></body>`,
  );
  return output;
}

async function fetchPage(
  path,
  { allowNotFound = false, returnNullOnNotFound = false } = {},
) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const serverUrl = serverUrls[serverCursor % serverUrls.length];
      serverCursor += 1;
      const response = await fetch(`${serverUrl}${path}`, {
        headers: { accept: "text/html" },
      });
      if (response.status === 404) {
        if (returnNullOnNotFound) return null;
        if (allowNotFound) return await response.text();
      }
      if (!response.ok) {
        throw new Error(`${path}: HTTP ${response.status}`);
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
      }
    }
  }
  throw lastError;
}

async function writeGzip(path, text) {
  await mkdir(dirname(path), { recursive: true });
  await pipeline(
    Readable.from([text]),
    createGzip({ level: 6 }),
    createWriteStream(path),
  );
}

async function mapLimit(items, limit, worker) {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= items.length) return;
        await worker(items[index], index);
      }
    },
  );
  await Promise.all(workers);
}

async function rewriteCss(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await rewriteCss(path);
    } else if (entry.isFile() && extname(entry.name) === ".css") {
      const original = await readFile(path, "utf8");
      const updated = base
        ? original.replace(/url\(\s*(['"]?)\/(?!\/)/g, (_match, quote) => {
            return `url(${quote}${base}/`;
          })
        : original;
      if (updated !== original) await writeFile(path, updated);
    }
  }
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function directorySize(directory) {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      total += await directorySize(path);
    } else if (entry.isFile()) {
      total += (await stat(path)).size;
    }
  }
  return total;
}

function redirectPage({ title, fallback, script }) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<script>${script}</script>
</head>
<body>
<p>Redirigiendo… <a href="${escapeAttribute(fallback)}">Continuar</a>.</p>
<noscript><p>Active JavaScript o use el enlace anterior.</p></noscript>
</body>
</html>
`;
}

function chapterHref(corpusId, bookId, chapter, query) {
  const path = `${withBase("/read")}/${encodeURIComponent(corpusId)}/${encodeURIComponent(bookId)}/${chapter}/`;
  const suffix = query.toString();
  return suffix ? `${path}?${suffix}` : path;
}

function catalogueForRedirect(corpora) {
  const result = {};
  for (const corpus of corpora) {
    result[corpus.id] = {
      books: Object.fromEntries(
        corpus.books.map((book) => [book.id, book.chapters]),
      ),
      defaultBook:
        corpus.books.find((book) => book.id === "Genesis")?.id ??
        corpus.books[0]?.id ??
        null,
    };
  }
  return result;
}

function readRedirectPage(corpora) {
  const catalogue = catalogueForRedirect(corpora);
  const defaultCorpus = corpora[0]?.id ?? "";
  const defaultBook = catalogue[defaultCorpus]?.defaultBook ?? "";
  const fallback = chapterHref(
    defaultCorpus,
    defaultBook,
    1,
    new URLSearchParams(),
  );
  const script = `!function(){
    var base=${JSON.stringify(base)},catalogue=${JSON.stringify(catalogue)},defaultCorpus=${JSON.stringify(defaultCorpus)};
    var p=new URLSearchParams(location.search);
    function positiveInt(v){if(!/^\\d+$/.test(v||""))return null;var n=Number(v);return Number.isSafeInteger(n)&&n>0?n:null}
    var corpus=p.get("corpus")||defaultCorpus;
    var info=catalogue[corpus];
    var book=p.get("book")||(info&&info.defaultBook);
    var chapter=Number(p.get("chapter")||"1");
    var ok=info&&book&&Object.prototype.hasOwnProperty.call(info.books,book)&&Number.isInteger(chapter)&&chapter>=1&&chapter<=info.books[book];
    if(!ok){location.replace(base+"/404.html");return}
    var q=new URLSearchParams();
    ["translit","grammar","gloss"].forEach(function(k){if(p.get(k)==="1")q.set(k,"1")});
    var from=positiveInt(p.get("from")),to=positiveInt(p.get("to"));
    if(from!==null||to!==null){
      var a=from===null?1:from,b=to===null?a:to;
      if(a>b){var swap=a;a=b;b=swap}
      q.set("from",String(a));
      if(b!==a)q.set("to",String(b))
    }
    var path=base+"/read/"+encodeURIComponent(corpus)+"/"+encodeURIComponent(book)+"/"+chapter+"/";
    location.replace(path+(q.toString()?"?"+q:""))
  }();`;
  return redirectPage({ title: "Redirigiendo…", fallback, script });
}

function bookRedirectPage(corpusId, bookId, corpora) {
  const corpus = corpora.find((item) => item.id === corpusId);
  const book = corpus?.books.find((item) => item.id === bookId);
  const fallback = chapterHref(corpusId, bookId, 1, new URLSearchParams());
  if (!book) {
    return redirectPage({
      title: "Página no encontrada — BibleOL",
      fallback: withBase("/404.html"),
      script: `location.replace(${JSON.stringify(withBase("/404.html"))});`,
    });
  }
  const script = `!function(){
    var base=${JSON.stringify(base)},corpus=${JSON.stringify(corpusId)},book=${JSON.stringify(bookId)};
    var p=new URLSearchParams(location.search),q=new URLSearchParams();
    function positiveInt(v){if(!/^\\d+$/.test(v||""))return null;var n=Number(v);return Number.isSafeInteger(n)&&n>0?n:null}
    ["translit","grammar","gloss"].forEach(function(k){if(p.get(k)==="1")q.set(k,"1")});
    var from=positiveInt(p.get("from")),to=positiveInt(p.get("to"));
    if(from!==null||to!==null){
      var a=from===null?1:from,b=to===null?a:to;
      if(a>b){var swap=a;a=b;b=swap}
      q.set("from",String(a));
      if(b!==a)q.set("to",String(b))
    }
    var path=base+"/read/"+encodeURIComponent(corpus)+"/"+encodeURIComponent(book)+"/1/";
    location.replace(path+(q.toString()?"?"+q:""));
  }();`;
  return redirectPage({ title: "Redirigiendo…", fallback, script });
}

async function waitForServer(url, timeoutMs = 90_000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${url}/read/ETCBC4/Genesis/1`);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`El servidor no respondió en ${timeoutMs} ms: ${lastError}`);
}

async function main() {
  const catalogue = JSON.parse(await readFile(cataloguePath, "utf8"));
  const corpora = catalogue.corpora ?? [];
  const chapters = [];
  for (const corpus of corpora) {
    for (const book of corpus.books) {
      for (let chapter = 1; chapter <= book.chapters; chapter += 1) {
        chapters.push({ corpus, book, chapter });
      }
    }
  }
  const limit = Number(args.get("limit") ?? 0);
  const corpusFilter = args.get("corpus");
  const filtered = corpusFilter
    ? chapters.filter(({ corpus }) => corpus.id === corpusFilter)
    : chapters;
  const selectedChapters = limit > 0 ? filtered.slice(0, limit) : filtered;

  console.log(`Exportando ${selectedChapters.length} capítulos a ${outDir}`);
  console.log(`Base pública: ${base || "/"}`);

  const servers = [];
  try {
    if (startServer) {
      console.log(
        serverUrls.length === 1
          ? `Iniciando el servidor SSR en ${serverUrls[0]}…`
          : `Iniciando ${serverUrls.length} servidores SSR en ${serverUrls.join(", ")}…`,
      );
      for (const url of serverUrls) {
        const server = spawn(process.execPath, [serverEntry], {
          cwd: repoRoot,
          env: {
            ...process.env,
            HOST: "127.0.0.1",
            PORT: new URL(url).port || String(port),
            NODE_ENV: "production",
            STATIC_EXPORT: "1",
          },
          stdio: ["ignore", "pipe", "pipe"],
        });
        let serverLog = "";
        server.stdout.on("data", (chunk) => {
          serverLog = `${serverLog}${chunk}`.slice(-4000);
        });
        server.stderr.on("data", (chunk) => {
          serverLog = `${serverLog}${chunk}`.slice(-4000);
        });
        server.on("exit", (code) => {
          if (code !== 0 && code !== null) {
            console.error(
              `El servidor SSR (${url}) terminó con código ${code}:\n${serverLog}`,
            );
          }
        });
        servers.push(server);
      }
    }
    await Promise.all(serverUrls.map((url) => waitForServer(url)));

    if (!resume) {
      await rm(outDir, { recursive: true, force: true });
    }
    await mkdir(outDir, { recursive: true });
    // Replace the previous client assets; cached pages keep their data.
    await rm(join(outDir, "_astro"), { recursive: true, force: true });
    await cp(clientDir, outDir, { recursive: true, force: true });
    await installStyles(outDir);
    await writeFile(join(outDir, ".nojekyll"), "");

    let completed = 0;
    let skipped = 0;
    const missing = [];
    await mapLimit(
      selectedChapters,
      concurrency,
      async ({ corpus, book, chapter }) => {
        const path = `/read/${encodeURIComponent(corpus.id)}/${encodeURIComponent(book.id)}/${chapter}`;
        const dataDir = join(outDir, "data");
        const panelsPath = join(
          dataDir,
          "panels",
          corpus.id,
          book.id,
          `${chapter}.json.gz`,
        );
        const grammarPath = join(
          dataDir,
          "grammar",
          corpus.id,
          book.id,
          `${chapter}.html.gz`,
        );
        const pagePath = join(
          outDir,
          "read",
          corpus.id,
          book.id,
          String(chapter),
          "index.html",
        );

        if (
          resume &&
          (await exists(panelsPath)) &&
          (await exists(grammarPath)) &&
          (await exists(pagePath))
        ) {
          completed += 1;
          return;
        }

        const [defaultHtml, grammarHtml] = await Promise.all([
          fetchPage(`${path}?translit=1&gloss=1`, {
            returnNullOnNotFound: true,
          }),
          fetchPage(`${path}?translit=1&gloss=1&grammar=1&panels=0`, {
            returnNullOnNotFound: true,
          }),
        ]);
        if (!defaultHtml || !grammarHtml) {
          missing.push(`${corpus.id}/${book.id}/${chapter}`);
          skipped += 1;
          completed += 1;
          if (completed % 25 === 0 || completed === selectedChapters.length) {
            console.log(
              `  ${completed}/${selectedChapters.length} capítulos revisados (${skipped} sin datos)`,
            );
          }
          return;
        }

        const defaultResult = extractPanels(defaultHtml);
        const grammarResult = extractPanels(grammarHtml);
        const panelMarkup = {};
        for (const item of [...defaultResult.panels, ...grammarResult.panels]) {
          if (!panelMarkup[item.monad]) panelMarkup[item.monad] = item.markup;
        }

        await writeGzip(panelsPath, JSON.stringify(panelMarkup));

        const grammar = extractGrammar(grammarResult.html);
        if (!grammar) {
          throw new Error(
            `No se encontró la vista gramatical de ${corpus.id}/${book.id}/${chapter}`,
          );
        }
        await writeGzip(grammarPath, grammar);

        await mkdir(dirname(pagePath), { recursive: true });
        await writeFile(
          pagePath,
          decorateChapter(defaultResult.html, corpus.id, book.id, chapter),
        );

        completed += 1;
        if (completed % 25 === 0 || completed === selectedChapters.length) {
          console.log(
            `  ${completed}/${selectedChapters.length} capítulos exportados${
              skipped ? ` (${skipped} sin datos)` : ""
            }`,
          );
        }
      },
    );
    if (missing.length) {
      console.log(
        `Capítulos sin datos en el corpus (se omiten): ${missing.length}\n  ${missing.join(", ")}`,
      );
    }

    const home = await fetchPage("/");
    await writeFile(
      join(outDir, "index.html"),
      prefixRootUrls(useStableStyles(home)),
    );

    const notFound = prefixRootUrls(
      useStableStyles(await fetchPage("/404", { allowNotFound: true })),
    );
    await writeFile(join(outDir, "404.html"), notFound);

    // Some corpora (notably the Latin Vulgate) do not contain every chapter
    // listed in their book order. Give those URLs a friendly page instead of
    // letting the previous/next links fall into the generic 404.
    if (missing.length) {
      const missingSet = new Set(missing);
      const availableByBook = new Map();
      const corpusById = new Map(corpora.map((corpus) => [corpus.id, corpus]));
      for (const { corpus, book, chapter } of selectedChapters) {
        const key = `${corpus.id}/${book.id}/${chapter}`;
        if (missingSet.has(key)) continue;
        const bookKey = `${corpus.id}/${book.id}`;
        if (!availableByBook.has(bookKey)) availableByBook.set(bookKey, []);
        availableByBook.get(bookKey).push(chapter);
      }
      for (const chapters of availableByBook.values()) {
        chapters.sort((a, b) => a - b);
      }

      for (const key of missing) {
        const [corpusId, bookId, chapterText] = key.split("/");
        const chapter = Number(chapterText);
        const available = availableByBook.get(`${corpusId}/${bookId}`) ?? [];
        const nearest =
          [...available].reverse().find((item) => item < chapter) ??
          available.find((item) => item > chapter) ??
          available[0];
        const corpus = corpusById.get(corpusId);
        if (nearest === undefined || !corpus) continue;

        const nearestPage = join(
          outDir,
          "read",
          corpusId,
          bookId,
          String(nearest),
          "index.html",
        );
        let nearestTitle = `${bookId} ${nearest}`;
        try {
          const nearestHtml = await readFile(nearestPage, "utf8");
          const titleMatch = nearestHtml.match(/<title>([^<]+)<\/title>/);
          if (titleMatch) {
            nearestTitle = titleMatch[1].split(" · ")[0];
          }
        } catch {
          // Keep the fallback title.
        }

        const message = `El corpus ${corpus.title} no incluye este capítulo. Puede continuar en ${nearestTitle}.`;
        const page = notFound
          .replace(
            "<title>No encontramos ese pasaje — BibleOL</title>",
            "<title>Capítulo no disponible — BibleOL</title>",
          )
          .replace(
            '<p class="eyebrow">404</p>',
            `<p class="eyebrow">${escapeAttribute(corpus.title)}</p>`,
          )
          .replace(
            "<h1>No encontramos ese pasaje</h1>",
            "<h1>Capítulo no disponible</h1>",
          )
          .replace(
            '<p class="not-found__text">El corpus, el libro o el capítulo no existe. Compruebe la dirección o vuelva a la selección.</p>',
            `<p class="not-found__text">${escapeAttribute(message)}</p>`,
          )
          .replace(
            `<a class="button button--primary" href="${withBase("/")}">Volver a la selección</a>`,
            `<a class="button button--primary" href="${withBase(
              `/read/${encodeURIComponent(corpusId)}/${encodeURIComponent(bookId)}/${nearest}/`,
            )}">Ir a ${escapeAttribute(nearestTitle)}</a> <a class="button" href="${withBase(
              "/",
            )}">Volver a la selección</a>`,
          );

        const pagePath = join(
          outDir,
          "read",
          corpusId,
          bookId,
          String(chapter),
          "index.html",
        );
        await mkdir(dirname(pagePath), { recursive: true });
        await writeFile(pagePath, page);
      }
    }

    await mkdir(join(outDir, "read"), { recursive: true });
    await writeFile(
      join(outDir, "read", "index.html"),
      readRedirectPage(corpora),
    );
    for (const corpus of corpora) {
      for (const book of corpus.books) {
        const bookDir = join(outDir, "read", corpus.id, book.id);
        await mkdir(bookDir, { recursive: true });
        await writeFile(
          join(bookDir, "index.html"),
          bookRedirectPage(corpus.id, book.id, corpora),
        );
      }
    }

    await rewriteCss(outDir);

    const size = await directorySize(outDir);
    const sizeMb = size / (1024 * 1024);
    console.log(`Sitio estático: ${sizeMb.toFixed(1)} MiB en ${outDir}`);
    if (size > 950 * 1024 * 1024) {
      throw new Error(
        "El sitio supera el límite de 1 GB de GitHub Pages; reduzca el contenido antes de publicar.",
      );
    }
  } finally {
    for (const server of servers) {
      server.kill("SIGTERM");
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
