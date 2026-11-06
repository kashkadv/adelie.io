# Adelie application image: one image for api, web, worker and migrations (different commands,
# see docker-compose.yml). Built on the server by scripts/deploy-app.sh from a clean `git archive`.
#
# NEXT_PUBLIC_* values are inlined into the web bundle at build time, so the image is per environment.
FROM node:24-slim

ENV CI=true \
    NEXT_TELEMETRY_DISABLED=1 \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

# The pnpm version must match `packageManager` in package.json.
RUN npm install -g pnpm@12.16.1 && rm -rf /root/.npm

WORKDIR /app
COPY . .

ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_APP_ENV
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_APP_ENV=$NEXT_PUBLIC_APP_ENV

RUN pnpm install --frozen-lockfile \
 && pnpm exec turbo run build --filter=@adelie/api --filter=@adelie/web --filter=@adelie/worker

ENV NODE_ENV=production
USER node
