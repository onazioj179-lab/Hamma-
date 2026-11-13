FROM node:22-bookworm-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/package.json
RUN npm ci
COPY web/ web/
RUN npm run build

FROM python:3.13-slim-bookworm AS native
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates cmake g++ ninja-build \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY LICENSE ./
COPY native/ native/
COPY processor/office_pdf.c .
RUN cmake -S native -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=OFF \
    && cmake --build build --target shante-core --parallel 2 \
    && cmake --install build --prefix /opt/shante --component ShanteCore
RUN apt-get update && apt-get install -y --no-install-recommends libreofficekit-dev \
    && cc -Wall -Wextra -Wno-unused-function -o /opt/shante/bin/hamma-office-pdf office_pdf.c -ldl

FROM python:3.13-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libstdc++6 libseccomp2 poppler-utils fonts-dejavu-core \
    fonts-liberation libreoffice-writer-nogui libreoffice-calc-nogui libreoffice-impress-nogui \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --create-home hamma \
    && mkdir -p /app/web/dist /data && chown hamma:hamma /data
WORKDIR /app
COPY processor/ processor/
COPY --from=web /app/web/dist/ web/dist/
COPY --from=native /opt/shante/ /opt/shante/
COPY --from=native /opt/shante/bin/hamma-office-pdf /usr/local/bin/
USER hamma
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HAMMA_DATA=/data \
    SHANTE_CORE_BINARY=/opt/shante/bin/shante-core
VOLUME ["/data"]
# Linux host networking intentionally retains the loopback-only bind.
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:5010/api/process/ready',timeout=3)"
CMD ["python", "-m", "processor.server"]
