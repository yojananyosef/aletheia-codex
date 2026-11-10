import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetAiConfigForTests } from "../src/lib/ai/config";
import { AiProviderError, AiRateLimitError } from "../src/lib/ai/errors";
import { explainPassage, resetAiServiceForTests } from "../src/lib/ai/service";

const dataDir = fileURLToPath(new URL("../../../data", import.meta.url));
const available =
  existsSync(join(dataDir, "metadata", "corpora.json")) &&
  existsSync(join(dataDir, "corpora", "ETCBC4.v24"));

function configure(overrides: Record<string, string> = {}): void {
  vi.stubEnv("BIBLEOL_DATA_DIR", dataDir);
  vi.stubEnv("BIBLEOL_AI_DB", ":memory:");
  vi.stubEnv("OPENROUTER_API_KEY", "test-key");
  vi.stubEnv("AI_ENABLED", "1");
  vi.stubEnv("AI_PER_USER_DAILY", "10");
  vi.stubEnv("AI_PER_USER_BURST", "10");
  vi.stubEnv("AI_GLOBAL_DAILY", "10");
  for (const [key, value] of Object.entries(overrides)) {
    vi.stubEnv(key, value);
  }
  resetAiConfigForTests();
  resetAiServiceForTests();
}

function mockCompletion(text = "Respuesta de prueba") {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        model: "google/gemma-4-31b-it:free",
        choices: [
          {
            message: { role: "assistant", content: text },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
          cost: 0,
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
}

const options = {
  corpusId: "ETCBC4",
  bookId: "Genesis",
  chapter: 1,
  from: 1,
  to: 1,
  mode: "resumen" as const,
  clientAddress: "192.0.2.1",
};

afterEach(() => {
  resetAiServiceForTests();
  resetAiConfigForTests();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe.skipIf(!available)("explainPassage", () => {
  it("caches an exact passage without consuming quota again", async () => {
    configure({ AI_PER_USER_DAILY: "1", AI_PER_USER_BURST: "1" });
    const fetchMock = mockCompletion();
    vi.spyOn(console, "info").mockImplementation(() => {});

    const first = await explainPassage(options);
    expect(first.cached).toBe(false);
    expect(first.text).toBe("Respuesta de prueba");

    const second = await explainPassage(options);
    expect(second.cached).toBe(true);
    expect(second.text).toBe("Respuesta de prueba");

    await expect(
      explainPassage({ ...options, from: 2, to: 2 }),
    ).rejects.toMatchObject({ reason: "user-daily" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("applies the per-minute burst limit to new passages", async () => {
    configure({ AI_PER_USER_DAILY: "10", AI_PER_USER_BURST: "1" });
    mockCompletion();
    vi.spyOn(console, "info").mockImplementation(() => {});

    await explainPassage(options);
    await expect(
      explainPassage({ ...options, from: 2, to: 2 }),
    ).rejects.toBeInstanceOf(AiRateLimitError);

    await expect(
      explainPassage({ ...options, from: 2, to: 2 }),
    ).rejects.toMatchObject({ reason: "burst" });
  });

  it("refunds the daily quota when the provider fails", async () => {
    configure({ AI_PER_USER_DAILY: "1", AI_PER_USER_BURST: "10" });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "fallo temporal" } }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: "google/gemma-4-31b-it:free",
            choices: [
              {
                message: { role: "assistant", content: "Respuesta recuperada" },
                finish_reason: "stop",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(explainPassage(options)).rejects.toBeInstanceOf(
      AiProviderError,
    );
    const recovered = await explainPassage(options);
    expect(recovered.cached).toBe(false);
    expect(recovered.text).toBe("Respuesta recuperada");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
