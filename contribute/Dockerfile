# Own Railway service → contribute.sunosathi.com. Build context is the REPO
# ROOT, not this folder, because the frontend compiles against two things it
# deliberately does not own a copy of: the shared pose format in
# frontend/src/lib/sign, and Track B's landmark extraction in sign-studio.
#
#   docker build -f contribute/Dockerfile .
#
# On Railway set the service's root directory to the repo root and point it
# at this Dockerfile.

# Stage 1: the contributor-facing web app
FROM node:22-slim AS webbuild
WORKDIR /build/contribute/frontend
COPY contribute/frontend/package.json contribute/frontend/package-lock.json* ./
RUN npm install --no-audit --no-fund
# The two borrowed sources have to be in place before tsc runs.
COPY frontend/src/lib/sign /build/frontend/src/lib/sign
COPY sign-studio/src/lib /build/sign-studio/src/lib
COPY contribute/frontend/ ./
# Fetches the MediaPipe wasm runtime and the ~14MB Holistic model into
# public/. Needs network at build time; both are pinned to the same model
# the studio uses so phone and studio clips extract identically.
RUN npm run build

# Stage 2: the API, serving its own static site
FROM python:3.12-slim
WORKDIR /app/backend
COPY contribute/backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY contribute/backend/ ./
COPY --from=webbuild /build/contribute/frontend/dist /app/frontend/dist
# CONTRIBUTE_DB should point into the Railway volume, e.g. /data/contribute.db
ENV CONTRIBUTE_DB=/data/contribute.db
EXPOSE 8000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
