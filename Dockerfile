FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run check:fixed:source
RUN npm run check:smtp:files && npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates tini && rm -rf /var/lib/apt/lists/*
COPY requirements-smtp.txt /tmp/requirements-smtp.txt
RUN python3 -m venv /opt/ed-smtp && /opt/ed-smtp/bin/pip install --no-cache-dir -r /tmp/requirements-smtp.txt
ENV SMTP_NTLM_PYTHON=/opt/ed-smtp/bin/python
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/tools ./tools
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json /app/wrangler.local.jsonc /app/requirements-smtp.txt ./
RUN mkdir -p /data/state /data/backups && chown -R node:node /data
USER node
# Validate the final artifact as its runtime user; no SMTP or database access.
RUN npm run check:smtp
RUN npm run check:fixed
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 D1_STATE_DIR=/data/state LOCAL_AUTH_BYPASS=false WRANGLER_SEND_METRICS=false WRANGLER_WRITE_LOGS=false
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 CMD ["node","tools/healthcheck.mjs"]
ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["python3","tools/runtime.py"]
