import type { AiConfig } from "./config";
import { AiProviderError } from "./errors";
import type { Prompt } from "./prompt";
import type { AiUsage } from "./types";

interface OpenRouterMessage {
  content?: unknown;
  reasoning?: unknown;
}

interface OpenRouterChoice {
  message?: OpenRouterMessage;
  finish_reason?: string | null;
}

interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
  completion_tokens_details?: {
    reasoning_tokens?: number;
  };
}

interface OpenRouterResponse {
  model?: string;
  choices?: OpenRouterChoice[];
  usage?: OpenRouterUsage;
  error?: {
    code?: number;
    message?: string;
    metadata?: unknown;
  };
}

export interface AiCompletion {
  text: string;
  model: string;
  finishReason: string | null;
  reasoningTokens: number | null;
  usage: AiUsage | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function extractText(message: OpenRouterMessage | undefined): string {
  if (!message) {
    return "";
  }
  if (typeof message.content === "string") {
    return message.content;
  }
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => {
        const record = asRecord(part);
        return typeof record?.text === "string" ? record.text : "";
      })
      .join("");
  }
  return "";
}

function parseUsage(usage: OpenRouterUsage | undefined): AiUsage | null {
  if (!usage) {
    return null;
  }
  const promptTokens =
    typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null;
  const completionTokens =
    typeof usage.completion_tokens === "number"
      ? usage.completion_tokens
      : null;
  const totalTokens =
    typeof usage.total_tokens === "number" ? usage.total_tokens : null;
  const cost = typeof usage.cost === "number" ? usage.cost : null;
  if (
    promptTokens === null &&
    completionTokens === null &&
    totalTokens === null &&
    cost === null
  ) {
    return null;
  }
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    cost,
  };
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds);
  }
  const date = Date.parse(value);
  if (Number.isNaN(date)) {
    return null;
  }
  return Math.max(1, Math.ceil((date - Date.now()) / 1_000));
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const body = await response.text();
    return body.slice(0, 500);
  } catch {
    return "";
  }
}

export async function requestCompletion(
  config: AiConfig,
  prompt: Prompt,
): Promise<AiCompletion> {
  if (!config.apiKey) {
    throw new AiProviderError({
      message: "Falta la clave de OpenRouter.",
      detail: "OPENROUTER_API_KEY is empty",
    });
  }

  const models = [config.model, ...config.fallbackModels].filter(Boolean);
  const body: Record<string, unknown> = {
    models,
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
    temperature: config.temperature,
    max_tokens: config.maxOutputTokens,
    usage: { include: true },
  };
  if (config.reasoning) {
    body.reasoning = { enabled: true, exclude: true };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": config.siteUrl,
        "X-Title": config.appName,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    const timedOut =
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError");
    throw new AiProviderError({
      message: timedOut
        ? "El proveedor de IA tardó demasiado en responder."
        : "No se pudo conectar con el proveedor de IA.",
      detail: timedOut
        ? `timeout after ${config.timeoutMs} ms`
        : error instanceof Error
          ? error.message
          : String(error),
    });
  }

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    clearTimeout(timer);
    throw new AiProviderError({
      message: `El proveedor de IA respondió con el estado ${response.status}.`,
      status: response.status,
      retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after")),
      detail,
    });
  }

  let payload: OpenRouterResponse;
  try {
    payload = (await response.json()) as OpenRouterResponse;
  } catch (error) {
    const timedOut = controller.signal.aborted;
    clearTimeout(timer);
    throw new AiProviderError({
      message: timedOut
        ? "El proveedor de IA tardó demasiado en responder."
        : "El proveedor de IA devolvió una respuesta ilegible.",
      detail: timedOut
        ? `timeout after ${config.timeoutMs} ms`
        : error instanceof Error
          ? error.message
          : String(error),
    });
  }
  clearTimeout(timer);

  if (payload.error) {
    throw new AiProviderError({
      message: "El proveedor de IA devolvió un error.",
      status:
        typeof payload.error.code === "number" ? payload.error.code : null,
      detail:
        typeof payload.error.message === "string"
          ? payload.error.message.slice(0, 500)
          : "unknown provider error",
    });
  }

  const choice = payload.choices?.[0];
  const text = extractText(choice?.message).trim();
  const usage = parseUsage(payload.usage);
  const reasoningTokens =
    typeof payload.usage?.completion_tokens_details?.reasoning_tokens ===
    "number"
      ? payload.usage.completion_tokens_details.reasoning_tokens
      : null;

  return {
    text,
    model:
      typeof payload.model === "string" && payload.model
        ? payload.model
        : config.model,
    finishReason: choice?.finish_reason ?? null,
    reasoningTokens,
    usage,
  };
}
