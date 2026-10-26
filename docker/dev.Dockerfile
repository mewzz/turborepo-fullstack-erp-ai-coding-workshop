# Development image shared by the install, api, web and studio services.
# The source code is NOT copied in: it is bind-mounted from your machine (see compose.yaml).
FROM node:24-slim

# openssl is needed by the Prisma schema engine (migrations).
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Corporate TLS interception (e.g. Zscaler) re-signs HTTPS traffic with a custom
# root CA. Register it so npm/node/pnpm can verify registry.npmjs.org.
COPY docker/zscaler-root-ca.crt /usr/local/share/ca-certificates/zscaler-root-ca.crt
RUN update-ca-certificates
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt

# Keep in sync with "packageManager" in the root package.json.
RUN npm install -g pnpm@12.15.0

# pnpm's package store lives in a named volume so re-installs are fast.
ENV pnpm_config_store_dir=/pnpm/store \
  TURBO_TELEMETRY_DISABLED=1
RUN mkdir -p /pnpm/store /workspace && chown -R node:node /pnpm /workspace

# Run as the non-root "node" user (uid 1000) so files created in the bind mount
# (node_modules, dist, migrations) are owned by you on Linux/WSL, not by root.
USER node
WORKDIR /workspace
