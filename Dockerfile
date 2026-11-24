# syntax=docker/dockerfile:1

# Build the complete Aletheia Codex SSR application, including the Emdros corpora,
# and run it as a Vercel container function. The image is built and run from
# /app so Astro's absolute build paths remain valid.

FROM node:26-bookworm-slim AS base
RUN npm install -g pnpm@12.18.0
WORKDIR /app

FROM base AS deps
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/corpus/package.json packages/corpus/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS builder
COPY data/metadata ./data/metadata
COPY scripts ./scripts
RUN pnpm data:sync
COPY . .
RUN pnpm build
RUN pnpm prune --prod
RUN rm -rf apps/web/.astro apps/web/node_modules/.astro

FROM node:26-bookworm-slim AS runner
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=80 \
    BIBLEOL_AI_DB=/tmp/ai.sqlite
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=builder /app/apps/web/dist ./apps/web/dist
COPY --from=builder /app/apps/web/package.json ./apps/web/package.json
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/data ./data
COPY --from=builder /app/package.json ./package.json
EXPOSE 80
CMD ["node", "apps/web/dist/server/entry.mjs"]
