# Kakure's arcade service (plan §0 R4): issues runs with their real-price tapes, replays every score before it ranks,
# keeps nickname boards in one SQLite file. Built from the repository root (`docker build -f services/arcade/Dockerfile
# .`; the root .dockerignore lets in only what it needs). Reached only through the site worker's /arcade/ path, which
# forwards fresh requests with nothing of the visitor's, so give it a domain and set the worker's ARCADE_ORIGIN.

FROM node:24-bookworm-slim AS build
WORKDIR /src
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter @kakure/arcade-server...
RUN pnpm --filter @kakure/arcade-server build

FROM node:24-bookworm-slim
WORKDIR /app
COPY --from=build /src/services/arcade/dist/server.js ./server.js
RUN mkdir -p /data && chown node:node /data
USER node
ENV PORT=8796 ARCADE_DB=/data/arcade.sqlite
# The SQLite book: players, issued seeds, runs. Mount it as a persistent volume.
VOLUME ["/data"]
EXPOSE 8796
CMD ["node", "server.js"]
