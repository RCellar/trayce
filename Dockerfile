FROM oven/bun:slim AS deps
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build:client

FROM oven/bun:slim
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist/client ./dist/client
COPY server/ ./server/
COPY package.json .

RUN mkdir -p /tmp/trayce/submissions && chown -R bun:bun /tmp/trayce

EXPOSE 9740

HEALTHCHECK --interval=15s --timeout=5s --retries=3 --start-period=5s \
  CMD bun --eval "fetch('http://localhost:9740').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

USER bun
CMD ["bun", "run", "server/index.ts"]
