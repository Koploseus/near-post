# NEAR Post on Fly: the relay (email login, gas, match days) serving the web app.
FROM node:26.13.0-alpine AS build
RUN npm install -g pnpm@12.16.1
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/relay/package.json apps/relay/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @near-post/relay... --filter @near-post/web...
COPY apps/relay apps/relay
COPY apps/web apps/web
RUN pnpm --filter @near-post/web build && pnpm --filter @near-post/relay build \
 && pnpm --filter @near-post/relay deploy --prod /out

FROM node:26.13.0-alpine
# su-exec: start as root only to hand the volume to the node user, then drop.
RUN apk add --no-cache su-exec
ENV NODE_ENV=production PORT=8080 WEB_DIST=/app/web DATA_DIR=/data
WORKDIR /app
COPY --from=build /out ./
COPY --from=build /app/apps/web/dist ./web
RUN mkdir -p /data && chown node:node /data
EXPOSE 8080
# Fly mounts the volume as root: give /data to node, then run as node.
CMD ["sh", "-c", "chown node:node /data && exec su-exec node node dist/main.js"]
