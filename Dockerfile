# Multi-stage security-hardened Dockerfile for AgentBox
FROM node:20-bookworm-slim AS base

# Install Python 3 for multi-language agent execution
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-minimal \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set production environment and security umask
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0

WORKDIR /app

# Copy application manifests
COPY package.json ./

# Copy source code and documentation
COPY src/ ./src/
COPY docs/ ./docs/

# Create isolated non-root workspace directory
RUN mkdir -p /app/workspace /app/logs && \
    chown -R node:node /app

# Switch to unprivileged user
USER node

# Expose HTTP/SSE Gateway port
EXPOSE 8080

# Built-in container healthcheck
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/health/live || exit 1

# Default command: Start HTTP/SSE Gateway
ENTRYPOINT ["node", "src/cli.js"]
CMD ["serve", "--port", "8080", "--host", "0.0.0.0"]
