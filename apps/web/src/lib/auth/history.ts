import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiMode } from "../ai/types";

export interface AnalysisRecord {
  id: string;
  cacheKey: string;
  corpusId: string;
  bookId: string;
  chapter: number;
  from: number;
  to: number;
  mode: AiMode;
  reference: string;
  text: string;
  model: string;
  createdAt: string;
}

export interface SaveAnalysisInput {
  cacheKey: string;
  corpusId: string;
  bookId: string;
  chapter: number;
  from: number;
  to: number;
  mode: AiMode;
  reference: string;
  text: string;
  model: string;
  promptVersion: number;
  usage?: {
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
    cost: number | null;
  } | null;
}

interface AnalysisRow {
  id: string;
  cache_key: string;
  corpus_id: string;
  book_id: string;
  chapter: number;
  verse_from: number;
  verse_to: number;
  mode: string;
  reference: string;
  text: string;
  model: string;
  created_at: string;
}

const COLUMNS =
  "id, cache_key, corpus_id, book_id, chapter, verse_from, verse_to, mode, reference, text, model, created_at";

function parseMode(value: string): AiMode {
  return value === "resumen" || value === "gramatica" ? value : "explicacion";
}

function mapRow(row: AnalysisRow): AnalysisRecord {
  return {
    id: row.id,
    cacheKey: row.cache_key,
    corpusId: row.corpus_id,
    bookId: row.book_id,
    chapter: row.chapter,
    from: row.verse_from,
    to: row.verse_to,
    mode: parseMode(row.mode),
    reference: row.reference,
    text: row.text,
    model: row.model,
    createdAt: row.created_at,
  };
}

export async function saveAnalysis(
  client: SupabaseClient,
  userId: string,
  input: SaveAnalysisInput,
): Promise<void> {
  const { error } = await client.from("analyses").upsert(
    {
      user_id: userId,
      cache_key: input.cacheKey,
      corpus_id: input.corpusId,
      book_id: input.bookId,
      chapter: input.chapter,
      verse_from: input.from,
      verse_to: input.to,
      mode: input.mode,
      reference: input.reference,
      text: input.text,
      model: input.model,
      prompt_version: input.promptVersion,
      usage: input.usage ?? null,
    },
    { onConflict: "user_id,cache_key" },
  );
  if (error) {
    throw new Error(error.message);
  }
}

export async function listAnalyses(
  client: SupabaseClient,
  userId: string,
  options: { limit: number; offset: number },
): Promise<{ items: AnalysisRecord[]; total: number }> {
  const { data, error, count } = await client
    .from("analyses")
    .select(COLUMNS, { count: "exact" })
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(options.offset, options.offset + options.limit - 1);
  if (error) {
    throw new Error(error.message);
  }
  return {
    items: ((data ?? []) as AnalysisRow[]).map(mapRow),
    total: count ?? 0,
  };
}

export async function getAnalysis(
  client: SupabaseClient,
  userId: string,
  id: string,
): Promise<AnalysisRecord | null> {
  const { data, error } = await client
    .from("analyses")
    .select(COLUMNS)
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return data ? mapRow(data as AnalysisRow) : null;
}

export async function deleteAnalysis(
  client: SupabaseClient,
  userId: string,
  id: string,
): Promise<boolean> {
  const { error, count } = await client
    .from("analyses")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) {
    throw new Error(error.message);
  }
  return (count ?? 0) > 0;
}

export async function countAnalyses(
  client: SupabaseClient,
  userId: string,
): Promise<{ total: number; latest: string | null }> {
  const { data, error, count } = await client
    .from("analyses")
    .select("created_at", { count: "exact" })
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    throw new Error(error.message);
  }
  const latest = (data as { created_at: string }[] | null)?.[0]?.created_at;
  return { total: count ?? 0, latest: latest ?? null };
}
