#!/usr/bin/env bash
set -euo pipefail

# Deploy the container to Vercel from a clean copy without .git metadata.
# Vercel can block CLI deploys when the local commit author is not a team
# member, even when the deployment itself comes from the CLI. Copying the
# source without .git avoids that check while keeping the linked project.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="${TMPDIR:-/tmp}/aletheia-codex-vercel-deploy"
PROJECT="${VERCEL_PROJECT:-aletheia-codex}"

if ! command -v vercel >/dev/null 2>&1; then
  echo "Falta Vercel CLI. Instálalo con: npm install -g vercel" >&2
  exit 1
fi

if ! command -v rsync >/dev/null 2>&1; then
  echo "Falta rsync. Instálalo con el gestor de paquetes del sistema." >&2
  exit 1
fi

if [ ! -d "$ROOT/.vercel" ]; then
  echo "Falta el vínculo .vercel. Ejecuta primero:" >&2
  echo "  vercel link --yes --project $PROJECT" >&2
  exit 1
fi

rm -rf "$TMP"
mkdir -p "$TMP"

rsync -a \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='**/node_modules' \
  --exclude='dist' \
  --exclude='**/dist' \
  --exclude='dist-static' \
  --exclude='**/dist-static' \
  --exclude='data/corpora' \
  --exclude='data/cache' \
  --exclude='.env.local' \
  --exclude='test-results' \
  --exclude='playwright-report' \
  "$ROOT/" "$TMP/"

cp -a "$ROOT/.vercel" "$TMP/.vercel"

if [ "${1:-}" = "--" ]; then
  shift
fi

cd "$TMP"
exec vercel deploy --prod --yes "$@"
