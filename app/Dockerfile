FROM node:20-slim AS build

WORKDIR /opt/custombasketball

COPY package.json package-lock.json tsconfig.json ./
COPY shared ./shared
COPY tools ./tools

RUN npm ci
RUN npm run build:tools

FROM node:20-slim

COPY --from=ghcr.io/blaxel-ai/sandbox:latest /sandbox-api /usr/local/bin/sandbox-api

RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium python3 ca-certificates fonts-liberation netcat-openbsd \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV CHROME_PATH=/usr/bin/chromium
ENV CHROME_BIN=/usr/bin/chromium

WORKDIR /opt/custombasketball

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /opt/custombasketball/dist/tools ./dist/tools
COPY docker/nic /usr/local/bin/nic
COPY docker/max /usr/local/bin/max
COPY docker/entrypoint.sh /entrypoint.sh

RUN chmod +x /usr/local/bin/nic /usr/local/bin/max /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
