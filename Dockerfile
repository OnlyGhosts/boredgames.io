# syntax=docker/dockerfile:1
# Multi-stage build: compile the client (Vite) and server (esbuild), then ship a small runtime image.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# su-exec: scripts/start.sh starts as root only to hand the Fly volume (mounted owned by root) to
# the node user, then runs the server as node.
RUN apk add --no-cache su-exec
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY scripts/start.sh ./start.sh
ENV PORT=3001
EXPOSE 3001
# The server serves dist/client and dist/admin (resolved from the working directory) and the /ws
# endpoint on $PORT, as the node user.
CMD ["sh", "./start.sh", "node", "dist/server/index.js"]
