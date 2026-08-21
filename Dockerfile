FROM node:24.18.0-bookworm-slim AS dependencies

ARG TARGETARCH
ARG NPM_REGISTRY=https://registry.npmjs.org
ARG PNPM_CACHE_ID=agent-server-pnpm-store
ARG PNPM_INSTALL_CACHE_BUST=stable

ENV COREPACK_HOME=/tmp/corepack \
    PNPM_HOME=/pnpm \
    PNPM_CONFIG_REGISTRY=$NPM_REGISTRY \
    PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false \
    NPM_CONFIG_REGISTRY=$NPM_REGISTRY \
    PATH=/pnpm:/opt/provider-toolchain-volume/current/bin:/opt/provider-toolchain-volume/current/paseo-toolchain/node_modules/.bin:$PATH \
    PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers \
    DISABLE_UPDATES=1

WORKDIR /workspace

# Preserve pnpm's workspace-relative links while validating copied app seeds.
RUN corepack enable \
    && corepack install --global pnpm@11.7.0 \
    && mkdir -p /pnpm /workspace/.local /workspace/node_modules /workspace/apps/web/node_modules /workspace/apps/web-vite/node_modules /workspace/dist /home/node/image-node_modules /home/node/image-web-node_modules /home/node/image-web-vite-node_modules /opt/playwright-browsers \
    && ln -s /home/node/image-node_modules /node_modules \
    && chown -R node:node /pnpm /workspace /home/node/image-node_modules /home/node/image-web-node_modules /home/node/image-web-vite-node_modules

USER node

COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=node:node apps/web/package.json ./apps/web/package.json
COPY --chown=node:node apps/web-vite/package.json ./apps/web-vite/package.json
COPY --chown=node:node patches/ ./patches/
RUN --mount=type=cache,id=${PNPM_CACHE_ID},target=/pnpm,uid=1000,gid=1000,sharing=locked test "$(id -u)" = 1000 \
    && test -w /pnpm \
    && test -n "$PNPM_INSTALL_CACHE_BUST" \
    && pnpm install --store-dir /pnpm/store --frozen-lockfile
# Re-materialize the seed in this revision so stale/corrupt exported layers
# cannot satisfy the dependency bootstrap check.
RUN set -eu; \
    cp -a /workspace/node_modules/. /home/node/image-node_modules/ \
    && cp -a /workspace/apps/web/node_modules/. /home/node/image-web-node_modules/ \
    && cp -a /workspace/apps/web-vite/node_modules/. /home/node/image-web-vite-node_modules/
# Keep the dependency seed fail-closed: the daemon and the API build both rely
# on package-manager bin links, and a stamp alone cannot prove they survived an
# image export/import.
RUN test -x /home/node/image-node_modules/.bin/tsc \
    && test -x /home/node/image-web-node_modules/.bin/tsc \
    && test -x /home/node/image-web-vite-node_modules/.bin/vite \
    && cd /workspace/apps/web-vite \
    && node -e "require.resolve('react/jsx-dev-runtime'); require.resolve('vite')"
COPY --chown=node:node scripts/dev/dependency-stamp.mjs ./scripts/dev/dependency-stamp.mjs
RUN node scripts/dev/dependency-stamp.mjs /workspace > /home/node/image-node_modules/.docker-dependencies-stamp \
    && cp /home/node/image-node_modules/.docker-dependencies-stamp /home/node/image-web-node_modules/.docker-dependencies-stamp \
    && cp /home/node/image-node_modules/.docker-dependencies-stamp /home/node/image-web-vite-node_modules/.docker-dependencies-stamp

# Two things the slim base omits that only bite at runtime, both masked for a
# long time because the smoke suite only ever exercised the opencode provider.
#
# procps: the Paseo daemon shells out to `ps` to reap agent child processes, so
# that spawn raises ENOENT as an *uncaught* exception and the daemon dies,
# taking scripts/dev/with-paseo.mjs and the container with it. Surfaces as
# "Paseo did not become healthy" long after a healthy start.
#
# ca-certificates: codex is a Rust binary and reads the system trust store,
# which is empty here, so *every* HTTPS request fails with "error sending
# request for url". Claude Code and opencode are Node and ship their own root
# store, which is why only the codex provider is affected — a mixed-provider
# Team cannot work at all without this.
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends procps ca-certificates python3 \
    && update-ca-certificates \
    && ps --version \
    && python3 --version \
    && test -s /etc/ssl/certs/ca-certificates.crt \
    && rm -rf /var/lib/apt/lists/*
USER node

FROM dependencies AS development

# Keep the deployment-verification image source-independent so an application
# edit does not force a multi-gigabyte runtime image export; only the
# build-time binary gate needs to be present in this stage.
COPY --chown=node:node scripts/dev/resolve-provider.mjs scripts/dev/resolve-opencode.mjs scripts/dev/resolve-paseo.mjs scripts/dev/safe-environment.mjs ./scripts/dev/
COPY --chown=node:node provider-toolchain/ ./provider-toolchain/

# Browser stage. `playwright install --with-deps` pulls a chromium shell plus
# dozens of apt packages, and it is the single most expensive layer in this
# image — on a fuse-overlayfs host it dominates total build time. Only the
# browser-driven suites need it (`vitest.web.config.ts` runs vitest in browser
# mode via playwright, and `test:e2e:web`), so it lives in its own stage and
# every backend target builds without it.
#
# Consequence, on purpose: with the default `development` target,
# `pnpm test:web` / `test:e2e:web` — and therefore `pnpm test` and `pnpm run ci`,
# which include them — cannot run. Build with `--target web-testing`
# when you need them.
FROM development AS web-testing

USER root
RUN apt-get update \
    && pnpm exec playwright install --with-deps --only-shell chromium \
    && chmod -R a+rX /opt/playwright-browsers \
    && rm -rf /var/lib/apt/lists/*
USER node
