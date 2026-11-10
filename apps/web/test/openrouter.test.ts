import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getAiConfig,
  resetAiConfigForTests,
  type AiConfig,
} from "../src/lib/ai/config";
import { AiProviderError } from "../src/lib/ai/errors";
import { requestCompletion } from "../src/lib/ai/openrouter";

function config(overrides: Partial<AiConfig> = {}): AiConfig {
  vi.stubEnv("OPENROUTER_API_KEY", "test-key");
  vi.stubEnv("AI_ENABLED", "1");
  resetAiConfigForTests();
  return { ...getAiConfig(), ...overrides };
}

function okResponse(text = "Respuesta de prueba"): Response {
  return new Response(
    JSON.stringify({
      model: "google/gemma-4-26b-a4b-it:free",
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
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetAiConfigForTests();
});

describe("requestCompletion", () => {
  it("routes by throughput and disables reasoning by default", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okResponse());

    const result = await requestCompletion(config(), {
      system: "sistema",
      user: "usuario",
    });

    expect(result.text).toBe("Respuesta de prueba");
    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body.models).toEqual([
      "google/gemma-4-26b-a4b-it:free",
      "nvidia/nemotron-3.5-lightning:free",
      "nvidia/nemotron-3-ultra-550b-a55b:free",
    ]);
    expect(body.max_tokens).toBe(2500);
    expect(body.provider).toEqual({
      sort: { by: "throughput", partition: "none" },
      allow_fallbacks: true,
    });
    expect(body.reasoning).toEqual({ enabled: false, exclude: true });
  });

  it("enables reasoning only when the configuration asks for it", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okResponse());

    await requestCompletion(config({ reasoning: true }), {
      system: "sistema",
      user: "usuario",
    });

    const init = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body.reasoning).toEqual({ enabled: true, exclude: true });
  });

  it("reports an aborted request as a provider timeout", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );

    const error = await requestCompletion(config({ timeoutMs: 20 }), {
      system: "sistema",
      user: "usuario",
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AiProviderError);
    expect((error as AiProviderError).detail).toBe("timeout after 20 ms");
  });
});
