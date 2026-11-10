import { NotFoundError } from "@bibleol/contracts";
import { bookName } from "../book-names";
import { getReader } from "../reader";
import type { AiBackend } from "./backend";
import { AiStore, cacheKey, hashIdentifier } from "./cache";
import { getAiConfig, type AiConfig } from "./config";
import {
  AiAuthRequiredError,
  AiBusyError,
  AiDisabledError,
  AiNotConfiguredError,
  AiPassageTooLargeError,
  AiPromptTooLargeError,
  AiProviderError,
  AiRateLimitError,
  AiStorageError,
} from "./errors";
import { cleanAiText } from "./format";
import { requestCompletion } from "./openrouter";
import { AI_PROMPT_VERSION, buildPrompt } from "./prompt";
import { RedisAiBackend } from "./redis";
import { SqliteAiBackend } from "./sqlite-backend";
import type { AiMode, AiResult } from "./types";

let store: AiStore | undefined;
let storePath: string | undefined;
let backend: AiBackend | undefined;
let backendKey: string | undefined;
let activeRequests = 0;

function getStore(config: AiConfig): AiStore {
  if (!store || storePath !== config.cacheDbPath) {
    try {
      store?.close();
      store = new AiStore(config.cacheDbPath);
      storePath = config.cacheDbPath;
    } catch (error) {
      store = undefined;
      storePath = undefined;
      throw new AiStorageError(
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  return store;
}

function getBackend(config: AiConfig): AiBackend {
  const key =
    config.redisUrl && config.redisToken
      ? `redis:${config.redisUrl}`
      : `sqlite:${config.cacheDbPath}`;
  if (!backend || backendKey !== key) {
    backend =
      config.redisUrl && config.redisToken
        ? new RedisAiBackend(config.redisUrl, config.redisToken)
        : new SqliteAiBackend(getStore(config));
    backendKey = key;
  }
  return backend;
}

/** Only used by tests that need to reopen the database with another path. */
export function resetAiServiceForTests(): void {
  store?.close();
  store = undefined;
  storePath = undefined;
  backend = undefined;
  backendKey = undefined;
  activeRequests = 0;
}

export function aiAvailable(): boolean {
  if (process.env.STATIC_EXPORT === "1") {
    return false;
  }
  const config = getAiConfig();
  return config.enabled && config.configured;
}

function selectVerses(
  verses: { number: number }[],
  from: number | null,
  to: number | null,
): { from: number; to: number } {
  const last = verses.at(-1)?.number ?? 1;
  if (from === null && to === null) {
    return { from: verses[0]?.number ?? 1, to: last };
  }
  let start = Math.min(Math.max(from ?? 1, 1), last);
  let end = Math.min(Math.max(to ?? start, 1), last);
  if (start > end) {
    [start, end] = [end, start];
  }
  return { from: start, to: end };
}

function acquireSlot(maxConcurrent: number): () => void {
  if (activeRequests >= maxConcurrent) {
    throw new AiBusyError();
  }
  activeRequests += 1;
  let released = false;
  return () => {
    if (!released) {
      released = true;
      activeRequests = Math.max(0, activeRequests - 1);
    }
  };
}

/**
 * Resolve the anonymous quota identifier. The raw address is never stored:
 * `hashIdentifier` hashes it with a server-side salt before it reaches SQLite.
 */
export function clientIdentifier(
  request: Request,
  socketAddress: string | undefined,
  config: AiConfig,
): string {
  if (config.trustProxy) {
    const forwarded = request.headers
      .get("x-forwarded-for")
      ?.split(",")[0]
      ?.trim();
    if (forwarded) {
      return forwarded.slice(0, 64);
    }
  }
  return (socketAddress?.trim() || "unknown").slice(0, 64);
}

export interface ExplainPassageOptions {
  corpusId: string;
  bookId: string;
  chapter: number;
  from: number | null;
  to: number | null;
  mode: AiMode;
  /** Authenticated Supabase user id. Required when `AI_REQUIRE_ACCOUNT` is on. */
  userId?: string | null;
  /** Anonymous fallback used only when account requirement is disabled. */
  clientAddress?: string;
}

export async function explainPassage(
  options: ExplainPassageOptions,
): Promise<AiResult> {
  const config = getAiConfig();
  if (!config.enabled) {
    throw new AiDisabledError();
  }
  if (!config.apiKey) {
    throw new AiNotConfiguredError();
  }
  if (config.requireAccount && !options.userId) {
    throw new AiAuthRequiredError();
  }

  const reader = getReader();
  const chapter = reader.getChapter(
    options.corpusId,
    options.bookId,
    options.chapter,
  );
  const range = selectVerses(chapter.verses, options.from, options.to);
  const verses = chapter.verses.filter(
    (verse) => verse.number >= range.from && verse.number <= range.to,
  );
  if (verses.length === 0) {
    throw new NotFoundError(
      `No hay versículos en el rango solicitado: ${options.corpusId}/${options.bookId}/${options.chapter}`,
    );
  }
  if (verses.length > config.maxVerses) {
    throw new AiPassageTooLargeError(config.maxVerses);
  }

  const prompt = buildPrompt({
    corpus: chapter.corpus,
    bookLabel: bookName(chapter.book.id),
    chapter: chapter.chapter,
    verses,
    grammar: chapter.grammar.objects,
    mode: options.mode,
  });
  const promptSize = prompt.system.length + prompt.user.length;
  if (promptSize > config.maxPromptChars) {
    throw new AiPromptTooLargeError(config.maxPromptChars);
  }

  const models = [config.model, ...config.fallbackModels].join("|");
  const key = cacheKey({
    model: models,
    prompt: `v${AI_PROMPT_VERSION}\n${prompt.system}\n\n${prompt.user}`,
    corpus: chapter.corpus.id,
    book: chapter.book.id,
    chapter: chapter.chapter,
    from: range.from,
    to: range.to,
    mode: options.mode,
  });

  const database = getBackend(config);
  let cached: Awaited<ReturnType<AiBackend["get"]>>;
  try {
    cached = await database.get(key);
  } catch (error) {
    throw new AiStorageError(
      error instanceof Error ? error.message : String(error),
    );
  }
  if (cached) {
    return {
      text: cached.text,
      model: cached.model,
      cacheKey: key,
      cached: true,
      createdAt: cached.createdAt,
      remaining: null,
      usage: null,
      from: range.from,
      to: range.to,
      verses: verses.length,
      mode: options.mode,
    };
  }

  const identifier = options.userId
    ? `user:${options.userId}`
    : hashIdentifier(options.clientAddress ?? "unknown", config.ipSalt);
  const release = acquireSlot(config.maxConcurrent);
  try {
    let decision: Awaited<ReturnType<AiBackend["consume"]>>;
    try {
      decision = await database.consume(identifier, {
        perUserDaily: config.perUserDaily,
        perUserBurst: config.perUserBurst,
        globalDaily: config.globalDaily,
      });
    } catch (error) {
      throw new AiStorageError(
        error instanceof Error ? error.message : String(error),
      );
    }
    if (!decision.allowed) {
      throw new AiRateLimitError({
        reason: decision.reason,
        retryAfterSeconds: decision.retryAfterSeconds,
        perUserDaily: config.perUserDaily,
        perUserBurst: config.perUserBurst,
      });
    }

    try {
      const completion = await requestCompletion(config, prompt);
      const text = cleanAiText(completion.text).slice(0, 60_000);
      if (!text) {
        throw new AiProviderError({
          message: "El proveedor de IA devolvió una respuesta vacía.",
          detail: `finish_reason=${completion.finishReason ?? "unknown"} reasoning_tokens=${
            completion.reasoningTokens ?? "unknown"
          }`,
        });
      }

      const createdAt = Date.now();
      try {
        await database.set(
          key,
          { text, model: completion.model, createdAt },
          config.cacheTtlDays * 24 * 60 * 60 * 1_000,
          createdAt,
        );
      } catch (error) {
        // A cache write failure must not discard an answer the provider
        // already generated. The quota is consumed by the request.
        console.error(
          `[ai] no se pudo guardar la respuesta en caché: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      console.info(
        `[ai] ${chapter.corpus.id}/${chapter.book.id}/${chapter.chapter}:${range.from}-${range.to} ${options.mode} model=${completion.model} tokens=${
          completion.usage?.totalTokens ?? "?"
        } cost=${completion.usage?.cost ?? "?"}`,
      );

      return {
        text,
        model: completion.model,
        cacheKey: key,
        cached: false,
        createdAt,
        remaining: decision.reservation.remaining,
        usage: completion.usage,
        from: range.from,
        to: range.to,
        verses: verses.length,
        mode: options.mode,
      };
    } catch (error) {
      try {
        await database.refund(decision.reservation);
      } catch (refundError) {
        console.error(
          `[ai] no se pudo devolver la cuota: ${
            refundError instanceof Error
              ? refundError.message
              : String(refundError)
          }`,
        );
      }
      throw error;
    }
  } finally {
    release();
  }
}
