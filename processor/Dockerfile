FROM node:22-bookworm-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/package.json
RUN npm ci
COPY web/ web/
RUN npm run build

FROM python:3.13-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --create-home hamma \
    && mkdir -p /app/web/dist /data && chown hamma:hamma /data
WORKDIR /app
COPY processor/ processor/
COPY --from=web /app/web/dist/ web/dist/
USER hamma
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HAMMA_DATA=/data
VOLUME ["/data"]
# Linux host networking intentionally retains the loopback-only bind.
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:5010/api/process/capabilities',timeout=3)"
CMD ["python", "-m", "processor.server"]
