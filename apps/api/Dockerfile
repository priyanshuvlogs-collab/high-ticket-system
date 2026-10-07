# BookedAI API image. Build context = repo root:  docker build -f apps/api/Dockerfile .
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app
ENV NODE_ENV=production
ENV CI=true

# Install deps first for layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/agent/package.json packages/agent/
COPY packages/db/package.json packages/db/
COPY packages/integrations/package.json packages/integrations/
# apps/web is in the workspace; give pnpm its manifest so the lockfile resolves, but we never build it here.
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --prod=false

# Source + Prisma client
COPY tsconfig.base.json tsconfig.json vitest.config.ts ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY scripts ./scripts
RUN pnpm db:generate

EXPOSE 4000
CMD ["pnpm", "deploy:boot"]
