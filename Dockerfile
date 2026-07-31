FROM node:24.18.0-bookworm-slim AS dependencies

ARG TARGETARCH
ARG NPM_REGISTRY=https://registry.npmjs.org

ENV COREPACK_HOME=/tmp/corepack \
    PNPM_HOME=/pnpm \
    PNPM_CONFIG_REGISTRY=$NPM_REGISTRY \
    NPM_CONFIG_REGISTRY=$NPM_REGISTRY \
    PATH=/pnpm:$PATH \
    OPENCODE_BIN=/opt/opencode/bin/opencode

WORKDIR /workspace

RUN corepack enable \
    && corepack install --global pnpm@11.7.0 \
    && mkdir -p /pnpm /workspace/.local /workspace/node_modules /workspace/dist /home/node/image-node_modules /opt/opencode/bin \
    && chown -R node:node /pnpm /workspace /home/node/image-node_modules /opt/opencode

USER node

COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
RUN set -eu; \
    case "$TARGETARCH" in \
      arm64) opencode_package=opencode-linux-arm64 ;; \
      amd64) opencode_package=opencode-linux-x64 ;; \
      *) echo "Unsupported Docker architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    opencode_version="$(OPENCODE_PACKAGE="$opencode_package" node --input-type=module -e "import { readFile } from 'node:fs/promises'; const packageJson = JSON.parse(await readFile('/workspace/package.json', 'utf8')); process.stdout.write(packageJson.optionalDependencies?.[process.env.OPENCODE_PACKAGE] ?? '')")"; \
    test -n "$opencode_version"; \
    npm install --prefix /opt/opencode --no-save --ignore-scripts "$opencode_package@$opencode_version"; \
    ln -sfn "../node_modules/$opencode_package/bin/opencode" /opt/opencode/bin/opencode; \
    /opt/opencode/bin/opencode --version
RUN mkdir -p /home/node/image-node_modules \
    && cp -a /workspace/node_modules/. /home/node/image-node_modules/
RUN node --input-type=module -e "import { createHash } from 'node:crypto'; import { readFile, writeFile } from 'node:fs/promises'; const hash = createHash('sha256'); for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) hash.update(await readFile('/workspace/' + file)); await writeFile('/home/node/image-node_modules/.docker-dependencies-stamp', hash.digest('hex') + '\\n');"

FROM dependencies AS development

COPY --chown=node:node . .
RUN node scripts/dev/resolve-opencode.mjs --check
