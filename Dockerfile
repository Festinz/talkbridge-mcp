FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY public ./public
COPY workers ./workers
RUN npm run build

FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV MCP_BIND_HOST=0.0.0.0
ENV CHATPOLISH_PYTHON=/opt/venv/bin/python
ENV CHATPOLISH_ARGOS_ENABLED=1
ENV CHATPOLISH_ARGOS_TIMEOUT_MS=2800
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates libgomp1 \
  && rm -rf /var/lib/apt/lists/* \
  && python3 -m venv /opt/venv

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY requirements-argos.txt ./
COPY workers/install_argos_models.py ./workers/install_argos_models.py
RUN /opt/venv/bin/pip install --no-cache-dir -r requirements-argos.txt \
  && /opt/venv/bin/python workers/install_argos_models.py
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/workers ./workers

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
