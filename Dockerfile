# syntax=docker/dockerfile:1

###########################################################################
# Stage build — compile the purely browser-side bundle with reproducible
# dependency install from the lockfile.
###########################################################################
FROM node:20-bookworm-slim AS build
WORKDIR /app

# Install all deps (devDependencies are needed for tsc + vite).
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

###########################################################################
# Stage web — static nginx image that actually publishes the audit page.
###########################################################################
FROM nginx:1.27-bookworm AS web

# curl is used by the container health check against /healthz.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=5s --timeout=3s --start-period=3s --retries=12 \
    CMD curl -fsS http://127.0.0.1/healthz || exit 1

###########################################################################
# Stage verify — one-shot acceptance container:
#   * vitest exact-criteria unit tests (BigInt projective audit)
#   * Playwright driving the *published* nginx page over the internal network
# Everything it needs is baked in, so it runs with no internet access.
###########################################################################
FROM node:20-bookworm-slim AS verify
WORKDIR /app

# Pin the browser location so it is readable by the unprivileged runner.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    npm_config_update_notifier=false \
    CI=true

# npm dependencies (including @playwright/test and vitest); skip the npm
# postinstall browser download because the explicit step below also installs
# the required OS shared libraries ...
COPY package.json package-lock.json ./
RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --no-audit --no-fund \
# ... the matching Chromium plus its OS shared libraries (build-time network only)
    && npx playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/* /root/.cache

COPY . .

# Build once so the unit tests and any fallback preview work, then hand the
# source and browser over to an unprivileged user.
RUN npm run build \
    && useradd --create-home --uid 1001 pwuser \
    && chown -R pwuser:pwuser /app /ms-playwright
USER pwuser

# E2E_BASE_URL is supplied by Compose (http://app/). The command fails the
# container (non-zero exit) if either the exact criteria or the real-page
# operations fail.
CMD ["sh", "-c", "npm run test:unit && npx playwright test --reporter=list"]
