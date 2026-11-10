import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { getDataPaths } from "../data-paths";

// The mixture-of-experts Gemma variant is markedly faster than the dense 31B
// model, which is what matters on free endpoints that queue requests.
const DEFAULT_MODEL = "google/gemma-4-26b-a4b-it:free";
const DEFAULT_FALLBACK_MODELS = [
  "nvidia/nemotron-3.5-lightning:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
];

function readString(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

function readList(name: string, fallback: string[]): string[] {
  const value = process.env[name]?.trim();
  if (!value) {
    return fallback;
  }
  if (value === "-") {
    return [];
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readInteger(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = process.env[name]?.trim();
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, minimum), maximum);
}

function readFloat(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = process.env[name]?.trim();
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, minimum), maximum);
}

function readBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) {
    return fallback;
  }
  if (["1", "true", "yes", "on"].includes(value)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(value)) {
    return false;
  }
  return fallback;
}

export interface AiConfig {
  enabled: boolean;
  configured: boolean;
  apiKey: string | null;
  model: string;
  fallbackModels: string[];
  baseUrl: string;
  siteUrl: string;
  appName: string;
  timeoutMs: number;
  temperature: number;
  maxVerses: number;
  maxPromptChars: number;
  maxOutputTokens: number;
  perUserDaily: number;
  perUserBurst: number;
  globalDaily: number;
  maxConcurrent: number;
  cacheTtlDays: number;
  cacheDbPath: string;
  redisUrl: string | null;
  redisToken: string | null;
  trustProxy: boolean;
  ipSalt: string;
  reasoning: boolean;
  requireAccount: boolean;
}

let cached: AiConfig | undefined;

export function getAiConfig(): AiConfig {
  if (cached) {
    return cached;
  }

  const apiKey = process.env.OPENROUTER_API_KEY?.trim() || null;
  const enabled = readBoolean("AI_ENABLED", apiKey !== null);
  const dataDir = getDataPaths().dataDir;
  const configuredDb = process.env.BIBLEOL_AI_DB?.trim();
  const redisUrl =
    process.env.KV_REST_API_URL?.trim() ||
    process.env.UPSTASH_REDIS_REST_URL?.trim() ||
    null;
  const redisToken =
    process.env.KV_REST_API_TOKEN?.trim() ||
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim() ||
    null;
  const defaultSalt = apiKey
    ? createHash("sha256")
        .update(`bibleol:${apiKey}`)
        .digest("hex")
        .slice(0, 16)
    : "bibleol-ai";

  cached = {
    enabled,
    configured: apiKey !== null,
    apiKey,
    model: readString("AI_MODEL", DEFAULT_MODEL),
    fallbackModels: readList("AI_FALLBACK_MODELS", DEFAULT_FALLBACK_MODELS),
    baseUrl: readString("AI_BASE_URL", "https://openrouter.ai/api/v1").replace(
      /\/+$/,
      "",
    ),
    siteUrl: readString("AI_SITE_URL", "http://localhost:4321").replace(
      /\/+$/,
      "",
    ),
    appName: "BibleOL",
    timeoutMs: readInteger("AI_TIMEOUT_MS", 120_000, 5_000, 300_000),
    temperature: readFloat("AI_TEMPERATURE", 0.3, 0, 2),
    maxVerses: readInteger("AI_MAX_VERSES", 80, 1, 176),
    maxPromptChars: readInteger("AI_MAX_PROMPT_CHARS", 120_000, 5_000, 500_000),
    maxOutputTokens: readInteger("AI_MAX_OUTPUT_TOKENS", 2_500, 256, 32_768),
    perUserDaily: readInteger("AI_PER_USER_DAILY", 15, 1, 1_000),
    perUserBurst: readInteger("AI_PER_USER_BURST", 3, 1, 60),
    globalDaily: readInteger("AI_GLOBAL_DAILY", 120, 1, 100_000),
    maxConcurrent: readInteger("AI_MAX_CONCURRENT", 3, 1, 20),
    cacheTtlDays: readInteger("AI_CACHE_TTL_DAYS", 30, 1, 3_650),
    cacheDbPath: configuredDb
      ? configuredDb === ":memory:"
        ? configuredDb
        : resolve(configuredDb)
      : resolve(dataDir, "cache", "ai.sqlite"),
    redisUrl,
    redisToken,
    trustProxy: readBoolean("AI_TRUST_PROXY", false),
    ipSalt: readString("AI_IP_SALT", defaultSalt),
    reasoning: readBoolean("AI_REASONING", false),
    requireAccount: readBoolean("AI_REQUIRE_ACCOUNT", true),
  };

  return cached;
}

/** Only used by tests that need to re-read the environment. */
export function resetAiConfigForTests(): void {
  cached = undefined;
}
