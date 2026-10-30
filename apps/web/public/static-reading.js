/*
 * Progressive enhancement for the static (GitHub Pages) reading snapshot.
 *
 * The exported HTML already contains the verses, transliterations and glosses.
 * This script only:
 *  - applies the query-string view state,
 *  - loads the word panels on demand,
 *  - swaps the verse list for the pre-rendered grammar view,
 *  - keeps chapter links, corpus tabs and the chapter form in sync.
 */
(() => {
  "use strict";

  const html = document.documentElement;
  if (!html.classList.contains("static-reading")) return;

  const base =
    html.dataset.base && html.dataset.base !== "/"
      ? html.dataset.base.replace(/\/+$/, "")
      : "";
  const corpus = html.dataset.corpus || "";
  const book = html.dataset.book || "";
  const chapter = html.dataset.chapter || "";
  const params = new URLSearchParams(location.search);
  const state = {
    translit: params.get("translit") === "1",
    gloss: params.get("gloss") === "1",
    grammar: params.get("grammar") === "1",
  };
  const toggleNames = ["translit", "gloss", "grammar"];

  function positiveInteger(value) {
    if (value === null) return null;
    const text = value.trim();
    if (!/^\d+$/.test(text)) return null;
    const number = Number(text);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }

  function lastVerseNumber() {
    let last = 0;
    for (const verse of document.querySelectorAll(".verse[id^='v']")) {
      const number = Number(verse.id.slice(1));
      if (Number.isSafeInteger(number) && number > last) last = number;
    }
    return last;
  }

  function readRange() {
    const from = positiveInteger(params.get("from"));
    const to = positiveInteger(params.get("to"));
    if (from === null && to === null) return null;

    const last = lastVerseNumber();
    if (last < 1) return null;

    let start = from ?? 1;
    let end = to ?? start;
    if (start > end) [start, end] = [end, start];
    start = Math.min(Math.max(start, 1), last);
    end = Math.min(Math.max(end, 1), last);
    if (start > end) [start, end] = [end, start];
    return { from: start, to: end };
  }

  function referenceOf(range) {
    if (!range) return null;
    return range.from === range.to
      ? String(range.from)
      : `${range.from}–${range.to}`;
  }

  function applyRange(range) {
    for (const verse of document.querySelectorAll(
      ".verse[id^='v'], .grammar-verse[id^='v']",
    )) {
      const number = Number(verse.id.slice(1));
      verse.hidden =
        range !== null && (number < range.from || number > range.to || !number);
    }
  }

  function syncRange(range) {
    const form = document.querySelector(".range-form");
    if (form) {
      const fromInput = form.querySelector('input[name="from"]');
      const toInput = form.querySelector('input[name="to"]');
      if (fromInput) fromInput.value = range ? String(range.from) : "";
      if (toInput) toInput.value = range ? String(range.to) : "";
    }

    const allLink = document.querySelector("[data-show-all]");
    if (allLink) {
      allLink.hidden = !range;
      const url = new URL(location.href);
      url.searchParams.delete("from");
      url.searchParams.delete("to");
      allLink.setAttribute("href", `${url.pathname}${url.search}`);
    }

    const header = document.querySelector(".reading-header");
    if (!header) return;

    const chapterSpan = header.querySelector(".reading-title__chapter");
    const baseChapter = chapterSpan?.dataset.chapter || chapter;
    const rangeReference = referenceOf(range);
    if (chapterSpan) {
      chapterSpan.textContent = rangeReference
        ? `${baseChapter}:${rangeReference}`
        : baseChapter;
    }

    const meta = header.querySelector(".reading-header__meta");
    const total = Number(header.dataset.total) || lastVerseNumber();
    const edition = meta?.dataset.edition || "";
    if (meta) {
      meta.textContent = range
        ? `${edition}${
            range.from === range.to ? "v." : "vv."
          } ${rangeReference} de ${total} versículos`
        : `${edition}${total} versículos`;
    }

    const reference = header.dataset.reference || baseChapter;
    const suffix = header.dataset.titleSuffix || "";
    document.title = range
      ? `${reference}:${rangeReference}${suffix}`
      : `${reference}${suffix}`;
  }

  function setToggle(url, key, on) {
    if (on) {
      url.searchParams.set(key, "1");
    } else {
      url.searchParams.delete(key);
    }
  }

  function applyToggles(url) {
    for (const key of toggleNames) {
      setToggle(url, key, state[key]);
    }
  }

  function toggleHref(key) {
    const url = new URL(location.href);
    setToggle(url, key, !state[key]);
    return `${url.pathname}${url.search}${url.hash}`;
  }

  function syncChrome() {
    html.classList.toggle("show-translit", state.translit);
    html.classList.toggle("show-gloss", state.gloss);
    html.classList.toggle("show-grammar", state.grammar);

    const hint = document.querySelector(".reading-tools__hint");
    if (hint) {
      const text = state.grammar
        ? hint.dataset.hintGrammar
        : hint.dataset.hintReading;
      if (text) hint.textContent = text;
    }

    for (const link of document.querySelectorAll("[data-toggle]")) {
      const key = link.dataset.toggle;
      if (!key || !(key in state)) continue;
      link.classList.toggle("tool-link--active", state[key]);
      const label = state[key]
        ? link.dataset.hideLabel
        : link.dataset.showLabel;
      if (label) link.textContent = label;
      link.setAttribute("href", toggleHref(key));
    }

    for (const link of document.querySelectorAll("a[href]")) {
      if (link.hasAttribute("data-toggle")) continue;
      const href = link.getAttribute("href");
      if (
        !href ||
        href.startsWith("#") ||
        /^(mailto|tel|javascript):/i.test(href)
      ) {
        continue;
      }
      const url = new URL(href, location.origin);
      if (url.origin !== location.origin) continue;
      if (!url.pathname.startsWith(`${base}/read/`)) continue;
      applyToggles(url);
      link.setAttribute("href", `${url.pathname}${url.search}`);
    }

    for (const form of document.querySelectorAll(
      "form.chapter-jump, form.range-form",
    )) {
      for (const key of toggleNames) {
        let input = form.querySelector(`input[name="${key}"]`);
        if (state[key]) {
          if (!input) {
            input = document.createElement("input");
            input.type = "hidden";
            input.name = key;
            form.append(input);
          }
          input.value = "1";
        } else if (input) {
          input.remove();
        }
      }
    }
  }

  async function fetchGzip(url) {
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) {
      throw new Error(`No se pudo cargar ${url} (HTTP ${response.status})`);
    }
    if (typeof DecompressionStream === "undefined" || !response.body) {
      throw new Error("Este navegador no puede descomprimir los datos.");
    }
    const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
    return await new Response(stream).text();
  }

  const dataBase = `${base}/data`;
  const dataPath = `${dataBase}/panels/${encodeURIComponent(corpus)}/${encodeURIComponent(book)}/${encodeURIComponent(chapter)}.json.gz`;
  const grammarPath = `${dataBase}/grammar/${encodeURIComponent(corpus)}/${encodeURIComponent(book)}/${encodeURIComponent(chapter)}.html.gz`;

  let panelsPromise = null;
  function loadPanels() {
    if (!panelsPromise) {
      panelsPromise = fetchGzip(dataPath).then((text) => JSON.parse(text));
    }
    return panelsPromise;
  }

  function openPanel(details) {
    const monad = details.dataset.monad;
    if (!monad) return;

    let panel = details.querySelector(":scope > .word__panel");
    if (panel && panel.dataset.loading !== "1") return;
    if (!panel) {
      panel = document.createElement("div");
      panel.className = "word__panel word__panel--loading";
      panel.dataset.loading = "1";
      panel.textContent = "Cargando…";
      details.append(panel);
    }

    loadPanels()
      .then((map) => {
        const markup = map[monad];
        if (!markup) {
          panel.remove();
          return;
        }
        const holder = document.createElement("div");
        holder.innerHTML = markup;
        const fresh = holder.firstElementChild;
        if (fresh) {
          panel.replaceWith(fresh);
        } else {
          panel.remove();
        }
      })
      .catch((error) => {
        console.error(error);
        panel.textContent = "No se pudieron cargar los datos de esta palabra.";
        panel.classList.remove("word__panel--loading");
        delete panel.dataset.loading;
      });
  }

  document.addEventListener(
    "toggle",
    (event) => {
      const target = event.target;
      if (
        target instanceof HTMLDetailsElement &&
        target.classList.contains("word") &&
        target.open
      ) {
        openPanel(target);
      }
    },
    true,
  );

  const prefetchPanels = () => {
    loadPanels().catch(() => {});
  };
  document.addEventListener(
    "pointerenter",
    (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".word")) {
        prefetchPanels();
      }
    },
    { capture: true, once: true },
  );
  document.addEventListener(
    "focusin",
    (event) => {
      if (event.target instanceof Element && event.target.closest(".word")) {
        prefetchPanels();
      }
    },
    { once: true },
  );

  let grammarPromise = null;
  function loadGrammar(range) {
    if (grammarPromise) return grammarPromise;

    const verses = document.querySelector(".verses");
    if (!verses) return Promise.resolve();

    const loader = document.createElement("p");
    loader.className = "static-loading";
    loader.textContent = "Cargando gramática…";
    verses.insertAdjacentElement("beforebegin", loader);

    grammarPromise = fetchGzip(grammarPath)
      .then((markup) => {
        loader.remove();
        const slot = document.createElement("div");
        slot.className = "grammar-slot";
        slot.innerHTML = markup;
        verses.insertAdjacentElement("beforebegin", slot);
        verses.hidden = true;
        applyRange(range);
      })
      .catch((error) => {
        console.error(error);
        loader.textContent = "No se pudo cargar la gramática.";
        loader.classList.add("static-loading--error");
        html.classList.remove("show-grammar");
        verses.hidden = false;
      });

    return grammarPromise;
  }

  const range = readRange();
  syncChrome();
  applyRange(range);
  syncRange(range);

  if (state.grammar) {
    loadGrammar(range);
  }
})();
