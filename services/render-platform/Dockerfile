FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY services/render-platform/package.json services/render-platform/package.json
RUN npm ci --ignore-scripts
COPY services/render-platform services/render-platform
RUN npm run production:build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates fonts-liberation fonts-noto-color-emoji fonts-noto-core && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
COPY package.json package-lock.json ./
COPY services/render-platform/package.json services/render-platform/package.json
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/services/render-platform/dist services/render-platform/dist
USER node
CMD ["node", "services/render-platform/dist/server.js"]
