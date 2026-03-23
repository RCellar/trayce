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

ENV TRAYCE_HOST=0.0.0.0
ENV TRAYCE_PORT=9740
EXPOSE 9740

USER bun
CMD ["bun", "run", "server/index.ts"]
