# ─── Stage 1: Build ───────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

# ─── Stage 2: Runtime ─────────────────────────────────
FROM node:20-alpine

# Security: non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy deps from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --chown=appuser:appgroup . .

# Remove dev artifacts
RUN rm -f .env

USER appuser

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:5000/health || exit 1

CMD ["node", "server.js"]
