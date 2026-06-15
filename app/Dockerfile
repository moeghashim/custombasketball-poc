FROM node:20-slim

COPY --from=ghcr.io/blaxel-ai/sandbox:latest /sandbox-api /usr/local/bin/sandbox-api

RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium python3 ca-certificates fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV CHROME_PATH=/usr/bin/chromium
ENV CHROME_BIN=/usr/bin/chromium

WORKDIR /opt/custombasketball

COPY dist/tools/nic.js /usr/local/bin/nic
COPY dist/tools/max.js /usr/local/bin/max

RUN chmod +x /usr/local/bin/nic /usr/local/bin/max

CMD ["sleep", "infinity"]
