import { devices, expect, test, type Locator } from "@playwright/test";

const nfc = (value: string) => value.normalize("NFC");

// `innerText` is intentional here: the verse text must exclude the hidden word
// panels that `textContent` would include.
// biome-ignore lint/performance/useDomNodeTextContent: se comprueba el texto visible
const visibleText = (locator: Locator) => locator.innerText();

test.describe("selección", () => {
  test("abre un capítulo desde el formulario sin JavaScript", async ({
    page,
  }) => {
    const consoleIssues: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") {
        consoleIssues.push(`${message.type()}: ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => consoleIssues.push(`pageerror: ${error}`));

    await page.goto("/");

    await expect(page).toHaveTitle("Aletheia Codex · Lectura bíblica");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Lea la Biblia en sus lenguas originales",
      }),
    ).toBeVisible();

    const card = page
      .locator(".corpus-card")
      .filter({ hasText: "Biblia hebrea" });

    await card.getByLabel("Libro").selectOption("Exodus");
    await card.getByLabel("Capítulo").fill("3");
    await card.getByRole("button", { name: "Leer" }).click();

    await expect(page).toHaveURL(/\/read\/ETCBC4\/Exodus\/3$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Éxodo 3");
    await expect(page.locator(".verse").first()).toBeVisible();
    expect(consoleIssues).toEqual([]);
  });

  test("el enlace de muestra abre el primer capítulo", async ({ page }) => {
    await page.goto("/");
    const card = page
      .locator(".corpus-card")
      .filter({ hasText: "Nuevo Testamento griego" });
    await card.getByRole("link", { name: "Abrir Mateo 1" }).click();

    await expect(page).toHaveURL(/\/read\/nestle1904\/Matthew\/1$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mateo 1");
  });

  test("abre un rango de versículos desde el formulario", async ({ page }) => {
    await page.goto("/");
    const card = page
      .locator(".corpus-card")
      .filter({ hasText: "Biblia hebrea" });

    await card.getByLabel("Libro").selectOption("Genesis");
    await card.getByLabel("Capítulo").fill("2");
    await card.getByLabel("Desde").fill("3");
    await card.getByLabel("Hasta").fill("5");
    await card.getByRole("button", { name: "Leer" }).click();

    await expect(page).toHaveURL(/\/read\/ETCBC4\/Genesis\/2\?from=3&to=5$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Génesis 2:3–5",
    );
    await expect(page.locator(".verse")).toHaveCount(3);
    await expect(page.locator(".verse").first()).toHaveAttribute("id", "v3");
    await expect(page.locator(".reading-header__meta")).toContainText(
      "25 versículos",
    );

    const nav = page.locator(".chapter-nav").first();
    await nav.getByLabel("Desde").fill("");
    await nav.getByLabel("Hasta").fill("");
    await nav.getByRole("button", { name: "Ir" }).click();
    await expect(page).toHaveURL(/\/read\/ETCBC4\/Genesis\/2$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Génesis 2",
    );
    await expect(page.locator(".verse")).toHaveCount(25);
  });
});

test.describe("lectura hebrea", () => {
  test("muestra el panel al pasar el cursor y lo cierra al salir", async ({
    page,
  }) => {
    await page.goto("/read/ETCBC4/Genesis/1");

    const firstWord = page.locator(".verse").first().locator(".word").first();
    const trigger = firstWord.locator(".word__trigger");
    const panel = firstWord.locator(".word__panel");

    await expect(panel).toBeHidden();
    const rail = page.locator(".word-inspector");
    await expect(rail).toBeVisible();
    await trigger.hover();
    await expect(panel).toBeVisible();
    await expect(
      panel.locator(".word__group-title", { hasText: "Forma en el texto" }),
    ).toBeVisible();

    const viewport = page.viewportSize();
    const sheetBox = await page.locator(".verses").boundingBox();
    const railBox = await rail.boundingBox();
    const panelBox = await panel.boundingBox();
    if (!viewport || !sheetBox || !railBox || !panelBox) {
      throw new Error("No se pudo medir el panel de la palabra.");
    }
    expect(panelBox.x).toBeGreaterThanOrEqual(sheetBox.x + sheetBox.width);
    expect(panelBox.x).toBeCloseTo(railBox.x, 0);
    expect(panelBox.y).toBeGreaterThanOrEqual(0);
    expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(viewport.height);

    await page.mouse.move(0, 0);
    await expect(panel).toBeHidden();
  });

  test("el panel de escritorio es ancho y no necesita scroll", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 775 });
    await page.goto("/read/ETCBC4/Genesis/1");

    const firstWord = page.locator(".verse").first().locator(".word").first();
    await firstWord.locator(".word__trigger").hover();
    const panel = firstWord.locator(".word__panel");
    await expect(panel).toBeVisible();

    const metrics = await panel.evaluate((element) => {
      const rows = [
        ...element.querySelectorAll(".word__features dt, .word__features dd"),
      ].map((row) => ({
        text: row.textContent?.trim() ?? "",
        height: row.getBoundingClientRect().height,
      }));
      return {
        width: element.getBoundingClientRect().width,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        wrapped: rows.filter((row) => row.height > 24),
      };
    });

    expect(metrics.width).toBeGreaterThanOrEqual(380);
    expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 1);
    expect(metrics.wrapped).toEqual([]);
  });

  test("muestra el texto RTL y los detalles gramaticales en español", async ({
    page,
  }) => {
    await page.goto("/read/ETCBC4/Genesis/1");

    await expect(page).toHaveTitle(
      "Génesis 1 · Biblia hebrea — Aletheia Codex",
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Génesis 1",
    );
    await expect(page.locator(".verse")).toHaveCount(31);

    const firstVerseText = page.locator(".verse__text").first();
    await expect(firstVerseText).toHaveAttribute("dir", "rtl");
    await expect(firstVerseText).toHaveAttribute("lang", "he");
    const verseText = nfc(await visibleText(firstVerseText)).replace(
      /\s+/g,
      "",
    );
    expect(verseText).toContain(nfc("בְּרֵאשִׁ֖ית").replace(/\s+/g, ""));

    const firstWord = page.locator(".verse").first().locator(".word").first();
    await firstWord.locator(".word__trigger").hover();

    const panel = firstWord.locator(".word__panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Gramática", { exact: true })).toBeVisible();
    await expect(
      panel.getByText("Lexema (con variante)", { exact: true }),
    ).toBeVisible();
    // The panel carries the full lexical entry, not just the preview.
    await expect(panel.locator('[data-group="lexeme"]')).toBeVisible();
    await expect(
      panel.locator("dt", { hasText: "Parte del discurso" }),
    ).toBeVisible();
    await expect(panel.locator("dt", { hasText: "Ocurrencias" })).toBeVisible();
    await expect(
      panel.locator("dt", { hasText: "Rango de frecuencia" }),
    ).toBeVisible();
    await expect(
      panel.locator("dt", { hasText: "Lexema (transliterado)" }),
    ).toBeVisible();
    await expect(panel.locator("dt", { hasText: "Texto" })).toBeVisible();
    await expect(
      panel.locator("dt", { hasText: "Transliteración" }),
    ).toBeVisible();
    await expect(panel.locator("dt", { hasText: "Idioma" })).toHaveCount(0);
    await expect(
      panel.locator(".word__group-title", { hasText: "Forma en el texto" }),
    ).toBeVisible();
    await expect(
      panel.locator(".word__group-title", { hasText: "Glosas" }),
    ).toBeVisible();
    await expect(
      panel.locator("dd", { hasText: /en, a \(hora, lugar\)/ }),
    ).toBeVisible();
    await expect(panel.getByText("español", { exact: true })).toBeVisible();

    const secondWord = page.locator(".verse").first().locator(".word").nth(1);
    await secondWord.locator(".word__trigger").hover();
    const secondPanel = secondWord.locator(".word__panel");
    await expect(
      secondPanel.locator(".word__group-title", { hasText: "Morfología" }),
    ).toBeVisible();
    await expect(
      secondPanel.getByText("Persona, género, número", { exact: true }),
    ).toBeVisible();
    await expect(secondPanel.locator("dd", { hasText: "-FSg" })).toBeVisible();
  });

  test("muestra la glosa española bajo la palabra y la conserva al navegar", async ({
    page,
  }) => {
    await page.goto("/read/ETCBC4/Genesis/1");

    await expect(page.locator(".word__gloss")).toHaveCount(0);

    await page.getByRole("link", { name: "Mostrar glosa" }).click();
    await expect(page).toHaveURL(/\/Genesis\/1\?gloss=1$/);

    const firstGloss = page.locator(".word__gloss").first();
    await expect(firstGloss).toBeVisible();
    await expect(firstGloss).toHaveAttribute("lang", "es");
    await expect(firstGloss).toContainText("en, a (hora, lugar)");

    await page
      .locator(".chapter-nav")
      .first()
      .locator(".chapter-step--next")
      .click();
    await expect(page).toHaveURL(/\/Genesis\/2\?gloss=1$/);
    await expect(page.locator(".word__gloss").first()).toBeVisible();

    await page.getByRole("link", { name: "Ocultar glosa" }).click();
    await expect(page).not.toHaveURL(/gloss=1/);
    await expect(page.locator(".word__gloss")).toHaveCount(0);
  });

  test("muestra la estructura gramatical y la conserva al navegar", async ({
    page,
  }) => {
    await page.goto("/read/ETCBC4/Genesis/1");

    await page.getByRole("link", { name: "Mostrar gramática" }).click();
    await expect(page).toHaveURL(/\/Genesis\/1\?grammar=1$/);
    await expect(page.locator(".verses")).toHaveCount(0);

    const grammar = page.locator(".grammar");
    await expect(grammar).toBeVisible();
    await expect(grammar.locator(".grammar-legend__item")).toHaveCount(3);
    await expect(
      grammar.locator('[data-level="sentence"]').first(),
    ).toContainText("Oración");
    await expect(
      grammar.locator('[data-level="clause"]').first(),
    ).toContainText("xQtX: x-qatal-X");
    await expect(
      grammar.locator('[data-level="phrase"]').first(),
    ).toContainText("PP fr. preposicional");
    expect(nfc(await visibleText(grammar))).toContain(nfc("בְּ"));

    const rtlNode = grammar.locator(".grammar-verse.rtl .grammar-node").first();
    await expect(rtlNode).toHaveCSS("border-right-width", "3px");
    await expect(rtlNode).toHaveCSS("border-left-width", "0px");
    await expect(
      grammar.locator(".grammar-verse.rtl .grammar-words").first(),
    ).toHaveCSS("text-align", "right");

    await page
      .locator(".chapter-nav")
      .first()
      .locator(".chapter-step--next")
      .click();
    await expect(page).toHaveURL(/\/Genesis\/2\?grammar=1$/);
    await expect(page.locator(".grammar")).toBeVisible();

    await page.getByRole("link", { name: "Ocultar gramática" }).click();
    await expect(page).not.toHaveURL(/grammar=1/);
    await expect(page.locator(".verses")).toBeVisible();
  });

  test("combina la transliteración con la vista gramatical", async ({
    page,
  }) => {
    await page.goto("/read/ETCBC4/Genesis/1?translit=1");

    await page.getByRole("link", { name: "Mostrar gramática" }).click();
    await expect(page).toHaveURL(/translit=1&grammar=1/);
    await expect(page.locator(".word__translit").first()).toBeVisible();
    await expect(page.locator(".grammar")).toBeVisible();

    await page.getByRole("link", { name: "Ocultar gramática" }).click();
    await expect(page).toHaveURL(/translit=1$/);
    await expect(page.locator(".word__translit").first()).toBeVisible();
  });

  test("alterna la transliteración mediante un enlace", async ({ page }) => {
    await page.goto("/read/ETCBC4/Genesis/1");

    await expect(page.locator(".word__translit")).toHaveCount(0);

    await page.getByRole("link", { name: "Mostrar transliteración" }).click();

    await expect(page).toHaveURL(/\?translit=1$/);
    await expect(page.locator(".word__translit").first()).toBeVisible();
    expect(
      nfc(await visibleText(page.locator(".word__translit").first())),
    ).toBe(nfc("bᵊ"));
    await expect(
      page.getByRole("link", { name: "Ocultar transliteración" }),
    ).toBeVisible();

    await page
      .locator(".chapter-nav")
      .first()
      .locator(".chapter-step--next")
      .click();
    await expect(page).toHaveURL(/\/read\/ETCBC4\/Genesis\/2\?translit=1$/);
    await expect(page.locator(".word__translit").first()).toBeVisible();

    const topNav = page.locator(".chapter-nav").first();
    await topNav.getByLabel("Libro").selectOption("Exodus");
    await topNav.getByLabel("Capítulo").fill("3");
    await topNav.getByRole("button", { name: "Ir" }).click();
    await expect(page).toHaveURL(/\/read\/ETCBC4\/Exodus\/3\?translit=1$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Éxodo 3");
    await expect(page.locator(".word__translit").first()).toBeVisible();

    await page.getByRole("link", { name: "Ocultar transliteración" }).click();
    await expect(page).not.toHaveURL(/translit=1/);
    await expect(page.locator(".word__translit")).toHaveCount(0);
  });

  test("limita la lectura a un versículo o a un rango", async ({ page }) => {
    await page.goto("/read/ETCBC4/Psalmi/119?from=5");
    await expect(page).toHaveTitle(
      "Salmos 119:5 · Biblia hebrea — Aletheia Codex",
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Salmos 119:5",
    );
    await expect(page.locator(".verse")).toHaveCount(1);
    await expect(page.locator(".verse").first()).toHaveAttribute("id", "v5");
    await expect(page.locator(".reading-header__meta")).toContainText(
      "176 versículos",
    );

    await page.goto("/read/ETCBC4/Psalmi/119?from=200");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Salmos 119:176",
    );
    await expect(page.locator(".verse")).toHaveCount(1);
    await expect(page.locator(".verse").first()).toHaveAttribute("id", "v176");

    await page.goto("/read/ETCBC4/Genesis/1?from=5&to=3");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Génesis 1:3–5",
    );
    await expect(page.locator(".verse")).toHaveCount(3);
    await expect(page.locator(".verse").first()).toHaveAttribute("id", "v3");
    await expect(page.getByLabel("Desde")).toHaveValue("3");
    await expect(page.getByLabel("Hasta")).toHaveValue("5");

    await page.goto("/read/ETCBC4/Genesis/1?to=3");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Génesis 1:1–3",
    );
    await expect(page.locator(".verse")).toHaveCount(3);
    await expect(page.locator(".verse").last()).toHaveAttribute("id", "v3");
  });

  test("integra el rango en el selector superior sin una barra aparte", async ({
    page,
  }) => {
    await page.goto("/read/ETCBC4/Psalmi/119?from=5&to=10");

    const nav = page.locator(".chapter-nav").first();
    await expect(nav.getByLabel("Desde")).toHaveValue("5");
    await expect(nav.getByLabel("Hasta")).toHaveValue("10");
    await expect(nav.getByRole("button", { name: "Ir" })).toBeVisible();
    await expect(page.getByLabel("Desde")).toHaveCount(1);
    await expect(page.locator(".reading-range")).toHaveCount(0);
    await expect(page.locator(".range-form")).toHaveCount(0);
    await expect(page.locator(".chapter-nav")).toHaveCount(1);
    await expect(page.locator("a.to-top")).toHaveCount(1);
    await expect(page.locator("a.to-top")).toHaveAttribute("href", "#top");
    await expect(page.locator("a.to-top")).toHaveAttribute(
      "aria-label",
      "Volver arriba",
    );
  });

  test("el selector de versículos conserva la vista y la navegación la descarta", async ({
    page,
  }) => {
    await page.goto("/read/ETCBC4/Genesis/1");

    const nav = page.locator(".chapter-nav").first();
    await nav.getByLabel("Desde").fill("2");
    await nav.getByLabel("Hasta").fill("4");
    await nav.getByRole("button", { name: "Ir" }).click();

    await expect(page).toHaveURL(/\/read\/ETCBC4\/Genesis\/1\?from=2&to=4$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Génesis 1:2–4",
    );
    await expect(page.locator(".verse")).toHaveCount(3);
    await expect(nav.getByLabel("Desde")).toHaveValue("2");
    await expect(nav.getByLabel("Hasta")).toHaveValue("4");

    await page.getByRole("link", { name: "Mostrar glosa" }).click();
    await expect(page).toHaveURL(
      /\/read\/ETCBC4\/Genesis\/1\?from=2&to=4&gloss=1$/,
    );
    await expect(page.locator(".verse")).toHaveCount(3);
    await expect(page.locator(".word__gloss").first()).toBeVisible();

    await page
      .locator(".chapter-nav")
      .first()
      .locator(".chapter-step--next")
      .click();
    await expect(page).toHaveURL(/\/read\/ETCBC4\/Genesis\/2\?gloss=1$/);
    await expect(page.locator(".verse")).toHaveCount(25);
  });

  test("muestra solo el rango en la vista gramatical", async ({ page }) => {
    await page.goto("/read/ETCBC4/Genesis/1?grammar=1&from=2&to=3");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Génesis 1:2–3",
    );
    await expect(page.locator(".reading-header__meta")).toContainText(
      "31 versículos",
    );
    await expect(page.locator(".grammar")).toBeVisible();
    await expect(page.locator(".grammar-verse")).toHaveCount(2);
    await expect(page.locator(".grammar-verse").first()).toHaveAttribute(
      "id",
      "v2",
    );
    await expect(page.locator(".grammar-verse").last()).toHaveAttribute(
      "id",
      "v3",
    );
  });

  test("navega entre capítulos y libros", async ({ page }) => {
    await page.goto("/read/ETCBC4/Genesis/1");
    const topNav = page.locator(".chapter-nav").first();

    await expect(topNav.locator(".chapter-step--next")).toContainText(
      "Génesis 2",
    );
    await expect(topNav.locator(".chapter-step--empty")).toHaveCount(1);

    await topNav.locator(".chapter-step--next").click();
    await expect(page).toHaveURL(/\/read\/ETCBC4\/Genesis\/2$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Génesis 2",
    );

    await page.goto("/read/ETCBC4/Genesis/50");
    const lastNav = page.locator(".chapter-nav").first();
    await expect(lastNav.locator(".chapter-step--next")).toContainText(
      "Éxodo 1",
    );

    await lastNav.locator(".chapter-step--next").click();
    await expect(page).toHaveURL(/\/read\/ETCBC4\/Exodus\/1$/);
    await expect(
      page.locator(".chapter-nav").first().locator(".chapter-step").first(),
    ).toContainText("Génesis 50");
  });
});

test.describe("panel de palabra fijado por foco", () => {
  test("el clic mantiene el panel abierto y el clic fuera lo cierra", async ({
    page,
  }) => {
    await page.goto("/read/ETCBC4/Genesis/1");

    const firstWord = page.locator(".verse").first().locator(".word").first();
    const trigger = firstWord.locator(".word__trigger");
    const panel = firstWord.locator(".word__panel");

    await trigger.click();
    await expect(panel).toBeVisible();
    await expect(panel.locator('[data-group="lexeme"]')).toBeVisible();

    await page.mouse.move(0, 0);
    await expect(panel).toBeVisible();

    // Clicking inside the card keeps it open.
    await panel.click({ position: { x: 8, y: 8 } });
    await expect(panel).toBeVisible();

    await page.getByRole("heading", { level: 1 }).click();
    await expect(panel).toBeHidden();
  });
});

test.describe("lectura griega y latina", () => {
  test("el griego se muestra LTR y sin transliteración", async ({ page }) => {
    await page.goto("/read/nestle1904/Matthew/1");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mateo 1");
    await expect(page.locator(".verse")).toHaveCount(25);
    const text = page.locator(".verse__text").first();
    await expect(text).toHaveAttribute("dir", "ltr");
    await expect(text).toHaveAttribute("lang", "grc");
    expect(nfc(await visibleText(text))).toContain(nfc("Βίβλος"));
    await expect(
      page.getByRole("link", { name: /transliteración/i }),
    ).toHaveCount(0);

    const firstWord = page.locator(".verse").first().locator(".word").first();
    await firstWord.locator(".word__trigger").hover();
    const panel = firstWord.locator(".word__panel");
    await expect(panel).toBeVisible();
    await expect(
      panel.locator(".word__group-title", { hasText: "Glosas" }),
    ).toBeVisible();
    await expect(panel.locator("dd", { hasText: "libro" })).toBeVisible();
    await expect(panel.getByText("español", { exact: true })).toBeVisible();
    await expect(panel.locator("dd", { hasText: "nominativo" })).toBeVisible();
    await expect(panel.locator("dd", { hasText: "-FSg" })).toBeVisible();

    await page.goto("/read/nestle1904/Matthew/1?grammar=1");
    const grammar = page.locator(".grammar");
    await expect(grammar).toBeVisible();
    await expect(grammar.locator(".grammar-legend__item")).toHaveCount(3);
    await expect(
      grammar.locator('[data-level="clause2"]').first(),
    ).toContainText("Cláusula nivel 2");
    await expect(
      grammar.locator('[data-level="clause1"]').first(),
    ).toContainText("Cláusula nivel 1");
    expect(nfc(await visibleText(grammar))).toContain(nfc("Βίβλος"));
  });

  test("el latín se muestra LTR con gramática", async ({ page }) => {
    await page.goto("/read/jvulgate/Matthew/1");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mateo 1");
    const text = page.locator(".verse__text").first();
    await expect(text).toHaveAttribute("dir", "ltr");
    await expect(text).toHaveAttribute("lang", "la");
    expect(await visibleText(text)).toContain("liber");

    const firstWord = page.locator(".verse").first().locator(".word").first();
    await firstWord.locator(".word__trigger").hover();
    const panel = firstWord.locator(".word__panel");
    await expect(panel).toBeVisible();
    await expect(panel.locator('[data-group="lexeme"]')).toBeVisible();
    await expect(panel.locator("dt", { hasText: "Ocurrencias" })).toBeVisible();
    await expect(
      panel.locator("dt", { hasText: "Rango de frecuencia" }),
    ).toBeVisible();
    await expect(panel.locator("dd", { hasText: "-MSg" })).toBeVisible();
    await expect(
      panel.locator(".word__group-title", { hasText: "Morfología" }),
    ).toBeVisible();

    await page.goto("/read/jvulgate/Matthew/1?grammar=1");
    await expect(page.locator(".grammar")).toBeVisible();
    await expect(
      page.locator('.grammar [data-level="sentence"]').first(),
    ).toContainText("Oración");
  });
});

test.describe("direcciones", () => {
  test("redirige las URL canónicas abreviadas", async ({ page }) => {
    await page.goto("/read?corpus=nestle1904&book=Matthew&chapter=2");
    await expect(page).toHaveURL(/\/read\/nestle1904\/Matthew\/2$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mateo 2");

    await page.goto("/read/ETCBC4/Genesis");
    await expect(page).toHaveURL(/\/read\/ETCBC4\/Genesis\/1$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Génesis 1",
    );

    await page.goto("/read/ETCBC4/Genesis?translit=1");
    await expect(page).toHaveURL(/\/read\/ETCBC4\/Genesis\/1\?translit=1$/);
    await expect(page.locator(".word__translit").first()).toBeVisible();

    await page.goto("/read/ETCBC4/Genesis?grammar=1");
    await expect(page).toHaveURL(/\/read\/ETCBC4\/Genesis\/1\?grammar=1$/);
    await expect(page.locator(".grammar")).toBeVisible();

    await page.goto(
      "/read?corpus=ETCBC4&book=Genesis&chapter=1&translit=1&grammar=1",
    );
    await expect(page).toHaveURL(
      /\/read\/ETCBC4\/Genesis\/1\?translit=1&grammar=1$/,
    );
    await expect(page.locator(".grammar")).toBeVisible();
    await expect(page.locator(".word__translit").first()).toBeVisible();
  });

  test("conserva el rango en las redirecciones", async ({ page }) => {
    await page.goto(
      "/read?corpus=ETCBC4&book=Genesis&chapter=1&from=2&to=4&gloss=1",
    );
    await expect(page).toHaveURL(
      /\/read\/ETCBC4\/Genesis\/1\?gloss=1&from=2&to=4$/,
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Génesis 1:2–4",
    );
    await expect(page.locator(".verse")).toHaveCount(3);

    await page.goto("/read/ETCBC4/Genesis?from=3");
    await expect(page).toHaveURL(/\/read\/ETCBC4\/Genesis\/1\?from=3$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Génesis 1:3",
    );
    await expect(page.locator(".verse")).toHaveCount(1);
  });

  test("responde 404 en español para pasajes inexistentes", async ({
    page,
  }) => {
    const response = await page.goto("/read/ETCBC4/Genesis/51");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "No encontramos ese pasaje",
    );
    await expect(
      page.getByRole("link", { name: "Volver a la selección" }),
    ).toBeVisible();

    const missingCorpus = await page.goto("/read/desconocido/Genesis/1");
    expect(missingCorpus?.status()).toBe(404);
  });
});

test.describe("producción", () => {
  test("el header se mantiene compacto", async ({ page }) => {
    await page.goto("/read/ETCBC4/Genesis/1");

    const headerHeight = await page
      .locator(".site-header")
      .evaluate((element) => element.getBoundingClientRect().height);

    expect(headerHeight).toBeLessThanOrEqual(64);
  });

  test("la lectura no incluye scripts ni recursos externos", async ({
    request,
  }) => {
    const response = await request.get("/read/ETCBC4/Genesis/1");
    expect(response.status()).toBe(200);

    const html = await response.text();
    expect(html).not.toContain("<script");
    // El canonical absoluto es deliberado; solo prohibimos recursos externos.
    const externalResource =
      /<(?:script|img|iframe)\b[^>]*\bsrc="https?:\/\/|<link\b[^>]*\brel="stylesheet"[^>]*\bhref="https?:\/\//i;
    expect(html).not.toMatch(externalResource);

    const font = await request.get("/fonts/ezra-sil.woff");
    expect(font.status()).toBe(200);
    expect((await font.body()).byteLength).toBeGreaterThan(10_000);
  });
});

test.describe("asistente de IA", () => {
  test("queda oculto y sin ruta cuando no hay clave", async ({
    page,
    request,
  }) => {
    await page.goto("/read/ETCBC4/Genesis/1");

    await expect(page.locator(".ai-panel")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Asistente IA" })).toHaveCount(
      0,
    );

    const response = await request.get(
      "/read/ETCBC4/Genesis/1/explain?generate=1",
    );
    expect(response.status()).toBe(404);
  });

  test("un ai=1 obsoleto no abre el panel si no hay clave", async ({
    page,
  }) => {
    await page.goto("/read/ETCBC4/Genesis/1?ai=1");

    await expect(page.locator(".ai-panel")).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Ocultar asistente" }),
    ).toHaveCount(0);
  });
});

test.describe("móvil", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: devices["iPhone 13"].deviceScaleFactor,
  });

  test("las pestañas compactas y el panel caben en 390 px", async ({
    page,
  }) => {
    await page.goto("/read/ETCBC4/Genesis/1");

    await expect(page.locator(".corpus-tab__short").first()).toBeVisible();
    await expect(page.locator(".corpus-tab__title").first()).toBeHidden();

    const firstWord = page.locator(".verse").first().locator(".word").first();
    await firstWord.locator(".word__trigger").tap();
    await expect(firstWord.locator(".word__panel")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    await page.goto("/read/ETCBC4/Genesis/1?grammar=1");
    await expect(page.locator(".grammar")).toBeVisible();
    const grammarWord = page.locator(".grammar .word").first();
    await grammarWord.locator(".word__trigger").tap();
    await expect(grammarWord.locator(".word__panel")).toBeVisible();

    const grammarOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(grammarOverflow).toBeLessThanOrEqual(1);
  });
});

test.describe("tableta", () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test("el panel de palabra no provoca desplazamiento horizontal", async ({
    page,
  }) => {
    await page.goto("/read/ETCBC4/Genesis/1");

    const firstWord = page.locator(".verse").first().locator(".word").first();
    await firstWord.locator(".word__trigger").hover();
    await expect(firstWord.locator(".word__panel")).toBeVisible();

    let overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    await page.goto("/read/ETCBC4/Genesis/1?grammar=1");
    const grammarWord = page.locator(".grammar .word").first();
    await grammarWord.locator(".word__trigger").hover();
    await expect(grammarWord.locator(".word__panel")).toBeVisible();

    overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
