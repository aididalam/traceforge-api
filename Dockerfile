# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:22.23.3-bookworm-slim
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=3000
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json LICENSE ./
LABEL org.opencontainers.image.licenses="MIT"
COPY migrations ./migrations
COPY scripts/container-health.mjs scripts/service-loop.mjs ./scripts/
RUN chmod -R a+rX /app
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
