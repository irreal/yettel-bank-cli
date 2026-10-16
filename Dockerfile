FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production YETTEL_CLI_HOME=/data PORT=8787
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
VOLUME /data
EXPOSE 8787
# Requires YETTEL_MCP_API_KEYS (>= 32 chars) and a session.json in /data.
CMD ["node", "dist/cli.js", "mcp", "--http", "--host", "0.0.0.0"]
