import { expect, test } from "@playwright/test";

const nfc = (value: string) => value.normalize("NFC");

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

    await expect(page).toHaveTitle("BibleOL · Lectura bíblica");
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
});

test.describe("lectura hebrea", () => {
  test("muestra el texto RTL y los detalles gramaticales en español", async ({
    page,
  }) => {
    await page.goto("/read/ETCBC4/Genesis/1");

    await expect(page).toHaveTitle("Génesis 1 · Biblia hebrea — BibleOL");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Génesis 1",
    );
    await expect(page.locator(".verse")).toHaveCount(31);

    const firstVerseText = page.locator(".verse__text").first();
    await expect(firstVerseText).toHaveAttribute("dir", "rtl");
    await expect(firstVerseText).toHaveAttribute("lang", "he");
    expect(nfc(await firstVerseText.innerText())).toContain(
      nfc("בְּרֵאשִׁ֖ית"),
    );

    const firstWord = page.locator(".verse").first().locator(".word").first();
    await firstWord.locator("summary").click();

    const panel = firstWord.locator(".word__panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Gramática", { exact: true })).toBeVisible();
    await expect(panel.getByText("Lema", { exact: true })).toBeVisible();
    await expect(panel.locator("dt", { hasText: "Categoría" })).toBeVisible();
    await expect(panel.locator("dd", { hasText: "preposición" })).toBeVisible();
    await expect(panel.locator("dd", { hasText: "hebreo" })).toBeVisible();
  });

  test("alterna la transliteración mediante un enlace", async ({ page }) => {
    await page.goto("/read/ETCBC4/Genesis/1");

    await expect(page.locator(".word__translit")).toHaveCount(0);

    await page.getByRole("link", { name: "Mostrar transliteración" }).click();

    await expect(page).toHaveURL(/\?translit=1$/);
    await expect(page.locator(".word__translit").first()).toBeVisible();
    expect(nfc(await page.locator(".word__translit").first().innerText())).toBe(
      nfc("bᵊ"),
    );
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

test.describe("lectura griega y latina", () => {
  test("el griego se muestra LTR y sin transliteración", async ({ page }) => {
    await page.goto("/read/nestle1904/Matthew/1");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mateo 1");
    await expect(page.locator(".verse")).toHaveCount(25);
    const text = page.locator(".verse__text").first();
    await expect(text).toHaveAttribute("dir", "ltr");
    await expect(text).toHaveAttribute("lang", "grc");
    expect(nfc(await text.innerText())).toContain(nfc("Βίβλος"));
    await expect(
      page.getByRole("link", { name: /transliteración/i }),
    ).toHaveCount(0);
  });

  test("el latín se muestra LTR con gramática", async ({ page }) => {
    await page.goto("/read/jvulgate/Matthew/1");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mateo 1");
    const text = page.locator(".verse__text").first();
    await expect(text).toHaveAttribute("dir", "ltr");
    await expect(text).toHaveAttribute("lang", "la");
    expect(await text.innerText()).toContain("liber");

    const firstWord = page.locator(".verse").first().locator(".word").first();
    await firstWord.locator("summary").click();
    const panel = firstWord.locator(".word__panel");
    await expect(panel).toBeVisible();
    await expect(panel.locator("dd", { hasText: "sustantivo" })).toBeVisible();
    await expect(panel.locator("dd", { hasText: "masculino" })).toBeVisible();
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
  test("la lectura no incluye scripts ni recursos externos", async ({
    request,
  }) => {
    const response = await request.get("/read/ETCBC4/Genesis/1");
    expect(response.status()).toBe(200);

    const html = await response.text();
    expect(html).not.toContain("<script");
    expect(html).not.toMatch(/(src|href)="https?:\/\//);

    const font = await request.get("/fonts/ezra-sil.woff");
    expect(font.status()).toBe(200);
    expect((await font.body()).byteLength).toBeGreaterThan(10_000);
  });
});

test.describe("móvil", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("las pestañas compactas y el panel caben en 390 px", async ({
    page,
  }) => {
    await page.goto("/read/ETCBC4/Genesis/1");

    await expect(page.locator(".corpus-tab__short").first()).toBeVisible();
    await expect(page.locator(".corpus-tab__title").first()).toBeHidden();

    const firstWord = page.locator(".verse").first().locator(".word").first();
    await firstWord.locator("summary").click();
    await expect(firstWord.locator(".word__panel")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe("tableta", () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test("el panel de palabra no provoca desplazamiento horizontal", async ({
    page,
  }) => {
    await page.goto("/read/ETCBC4/Genesis/1");

    const firstWord = page.locator(".verse").first().locator(".word").first();
    await firstWord.locator("summary").click();
    await expect(firstWord.locator(".word__panel")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
