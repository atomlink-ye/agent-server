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
# There is one canonical browser package: apps/web (React + Vite).
RUN corepack enable \
    && corepack install --global pnpm@11.7.0 \
    && mkdir -p /pnpm /workspace/.local /workspace/node_modules /workspace/apps/web/node_modules /workspace/dist /home/node/image-node_modules /home/node/image-web-node_modules /opt/playwright-browsers \
    && ln -s /home/node/image-node-modules /node_modules \
    && chown -R node:node /pnpm /workspace /home/node/image-node-modules /home/node/image-web-node-modules

USER node

COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=node:node apps/web/package.json ./apps/web/package.json
COPY --chown=node:node patches/ ./patches/
RUN --mount=type=cache,id=${PNPM_CACHE_ID},target=/pnpm,uid=1000,gid=1000,sharing=locked test "$(id -u)" = 1000 \
    && test -w /pnpm \
    && test -n "$PNPM_INSTALL_CACHE_BUST" \
    && pnpm install --store-dir /pnpm/store --frozen-lockfile
# Re-materialize the seed in this revision so stale/corrupt exported layers
# cannot satisfy the dependency bootstrap check.
RUN set -eu; \
    cp -a /workspace/node_modules/. /home/node/image-node-modules/ \
    && cp -a /workspace/apps/web/node_modules/. /home/node/image-web-node-modules/
# Keep the dependency seed fail-closed: the daemon and browser build rely on
# package-manager bin links, and a stamp alone cannot prove they survived an
# image export/import.
RUN test -x /home/node/image-node-modules/.bin/tsc \
    && test -x /home/node/image-web-node-modules/.bin/vite \
    && cd /workspace/apps/web \
    && node -e "require.resolve('react/jsx-dev-runtime'); require.resolve('vite')"
COPY --chown=node:node scripts/dev/dependency-stamp.mjs ./scripts/dev/dependency-stamp.mjs
RUN node scripts/dev/dependency-stamp.mjs /workspace > /home/node/image-node-modules/.docker-dependencies-stamp \
    && cp /home/node/image-node-modules/.docker-dependencies-stamp /home/node/image-web-node-modules/.docker-dependencies-stamp

# Runtime host utilities used by Paseo/Codex provider processes.
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

# Compose bind-mounts the checked-out repository at /workspace for every
# development service. Keep the image source-independent so an application
# edit does not force a multi-gigabyte runtime image export.
COPY --chown=node:node scripts/dev/resolve-provider.mjs scripts/dev/resolve-opencode.mjs scripts/dev/resolve-paseo.mjs scripts/dev/safe-environment.mjs ./scripts/dev/
COPY --chown=node:node provider-toolchain/ ./provider-toolchain/

# Browser-test stage. Chromium remains opt-in and is not part of ordinary dev.
FROM development AS web-testing

USER root
RUN apt-get update \
    && pnpm exec playwright install --with-deps --only-shell chromium \
    && chmod -R a+rX /opt/playwright-browsers \
    && rm -rf /var/lib/apt/lists/*
USER node
