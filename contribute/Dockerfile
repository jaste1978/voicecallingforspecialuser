# Own Railway service → contribute.sunosathi.com.
#
# Build context is the REPO ROOT (that is how scripts/deploy.sh ships it), so
# every path below is repo-relative:
#
#   docker build -f contribute/Dockerfile .
#
# Nothing outside contribute/ is copied. The two files this service borrows
# from the app and from Track B are committed into
# contribute/frontend/src/vendor by scripts/sync-sign-core.mjs, precisely so
# that a deploy never depends on another track's working tree.

# Stage 1: the contributor-facing web app
FROM node:22-slim AS webbuild
WORKDIR /build
COPY contribute/frontend/package.json contribute/frontend/package-lock.json* ./frontend/
WORKDIR /build/frontend
RUN npm ci --no-audit --no-fund
COPY contribute/frontend/ ./
COPY contribute/scripts/ ../scripts/
# `npm run build` fetches the MediaPipe wasm runtime and the ~14MB Holistic
# model into public/ (needs network), verifies the vendored copies have not
# drifted from their originals, then type-checks and bundles.
RUN npm run build

# Stage 2: the API, serving its own static site
FROM python:3.12-slim
WORKDIR /app/backend
COPY contribute/backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY contribute/backend/ ./
COPY --from=webbuild /build/frontend/dist /app/frontend/dist
# Point this at the mounted volume so the database survives a redeploy.
ENV CONTRIBUTE_DB=/data/contribute.db
EXPOSE 8000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
