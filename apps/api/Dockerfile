# Lumo API — built from the monorepo root:
#   docker build -f apps/api/Dockerfile -t lumo-api .
#
# The build context is the repository root because the API depends on
# workspace packages (@lumo/types) that live outside apps/api.

# ---- deps -------------------------------------------------------------------
FROM node:20-bookworm-slim AS deps
WORKDIR /repo

# argon2 has no prebuilt binary for every platform we build on, so it is
# compiled from source here. These toolchain packages exist only in the build
# stages and never reach the runtime image.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# Only the manifests, so the dependency layer is cached independently of source.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY patches ./patches
COPY apps/api/package.json ./apps/api/
COPY apps/mobile/package.json ./apps/mobile/
COPY packages/types/package.json ./packages/types/
COPY packages/api-client/package.json ./packages/api-client/
COPY packages/tsconfig/package.json ./packages/tsconfig/

# The API's postinstall generates the Prisma client, so the schema has to be
# present before install. It changes rarely, so this costs little caching.
COPY apps/api/prisma ./apps/api/prisma

# The mobile app is not part of this image and its native toolchain is large.
RUN pnpm install --frozen-lockfile --filter api... --filter @lumo/types...

# ---- build ------------------------------------------------------------------
FROM deps AS build
WORKDIR /repo

COPY packages ./packages
COPY apps/api ./apps/api

RUN pnpm --filter @lumo/types build \
 && pnpm --filter api build

# Drop dev dependencies from the tree that gets copied forward.
RUN pnpm install --frozen-lockfile --filter api... --filter @lumo/types... --prod

# ---- runtime ----------------------------------------------------------------
FROM node:20-bookworm-slim AS runtime
WORKDIR /repo

ENV NODE_ENV=production
ENV API_PORT=3005

# OpenSSL is required by Prisma's query engine.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma

# Never root. A process that only needs to listen on a port and talk to
# postgres has no business being able to write to its own image.
USER node

EXPOSE 3005

# Migrations are applied as a deliberate step before rollout, not implicitly on
# container start: a crash-looping container must not re-run schema changes,
# and on a product that stores emergency contacts a migration is a reviewed
# event. Run `pnpm --filter api db:deploy` from a job, then start this.
WORKDIR /repo/apps/api
CMD ["node", "dist/main"]
