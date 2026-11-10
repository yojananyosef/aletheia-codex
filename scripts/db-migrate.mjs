#!/usr/bin/env node
/**
 * Apply the SQL files in supabase/migrations to the provisioned Postgres.
 *
 * The Supabase Vercel integration writes POSTGRES_* variables to .env.local
 * (development) and to the Vercel project (production). This runner uses the
 * pooled connection and keeps its own ledger so it can be executed from a
 * laptop or from CI without the Supabase CLI.
 *
 *   pnpm db:migrate
 *   pnpm db:migrate --status
 */

import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const migrationsDir = join(repoRoot, "supabase", "migrations");
const envPath = join(repoRoot, ".env.local");
const statusOnly = process.argv.includes("--status");

function parseEnvFile(text) {
  const result = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

async function loadEnvironment() {
  let fileEnv = {};
  try {
    fileEnv = parseEnvFile(await readFile(envPath, "utf8"));
  } catch {
    // The file is optional in CI, where the variables come from the process.
  }
  return { ...fileEnv, ...process.env };
}

function connectionString(env) {
  const raw =
    env.POSTGRES_URL || env.POSTGRES_URL_NON_POOLING || env.DATABASE_URL;
  if (!raw) {
    throw new Error(
      "Falta POSTGRES_URL. Ejecute la integración de Supabase o defina la variable.",
    );
  }
  const url = new URL(raw);
  // pg v8 treats sslmode=require as verify-full and Supabase's pooler uses a
  // certificate chain that Node does not ship. The explicit ssl object below
  // keeps TLS while accepting the managed chain.
  url.searchParams.delete("sslmode");
  return url.toString();
}

async function listMigrations() {
  const entries = await readdir(migrationsDir);
  return entries.filter((name) => name.endsWith(".sql")).sort();
}

async function main() {
  const env = await loadEnvironment();
  const client = new pg.Client({
    connectionString: connectionString(env),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    await client.query(`
      create table if not exists public.app_migrations (
        version text primary key,
        applied_at timestamptz not null default now()
      );
    `);

    const applied = new Set(
      (
        await client.query("select version from public.app_migrations")
      ).rows.map((row) => row.version),
    );
    const migrations = await listMigrations();
    const pending = migrations.filter((name) => !applied.has(name));

    if (statusOnly) {
      for (const name of migrations) {
        console.log(`${applied.has(name) ? "aplicada" : "pendiente"}  ${name}`);
      }
      return;
    }

    if (pending.length === 0) {
      console.log("No hay migraciones pendientes.");
      return;
    }

    // Serialise concurrent runs from different machines.
    await client.query(
      "select pg_advisory_lock(hashtext('bibleol:migrations'))",
    );
    try {
      for (const name of pending) {
        const sql = await readFile(join(migrationsDir, name), "utf8");
        console.log(`Aplicando ${name}…`);
        await client.query("begin");
        try {
          await client.query(sql);
          await client.query(
            "insert into public.app_migrations (version) values ($1)",
            [name],
          );
          await client.query("commit");
        } catch (error) {
          await client.query("rollback");
          throw new Error(`Falló ${name}: ${error.message}`);
        }
      }
    } finally {
      await client.query(
        "select pg_advisory_unlock(hashtext('bibleol:migrations'))",
      );
    }

    console.log(`Aplicadas ${pending.length} migración(es).`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
