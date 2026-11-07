FROM docker.m.daocloud.io/library/node:24-bookworm-slim AS build
WORKDIR /app
ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm ci --no-audit --no-fund
COPY web web
RUN npm run build --workspace web

FROM docker.m.daocloud.io/library/node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NPM_CONFIG_REGISTRY=https://registry.npmmirror.com \
    PORT=3000 \
    MILVUS_ADDRESS=milvus:19530
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm ci --workspace server --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server/src server/src
COPY server/agent-workspace server/agent-workspace
COPY server/scripts server/scripts
COPY server/testdata server/testdata
COPY --from=build /app/web/dist web/dist
EXPOSE 3000
WORKDIR /app/server
CMD ["node", "--import", "jiti/register", "src/index.ts"]
