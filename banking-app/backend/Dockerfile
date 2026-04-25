# ─── Stage 1: Build ───────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

# ─── Stage 2: Runtime ─────────────────────────────────
FROM node:20-alpine

# Install curl (more reliable than wget)
RUN apk add --no-cache curl

# Security: non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy dependencies & app
COPY --from=builder /app/node_modules ./node_modules
COPY --chown=appuser:appgroup . .

# Remove sensitive files
RUN rm -f .env

USER appuser

EXPOSE 5000

# ✅ Stable Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:5000/health || exit 1

CMD ["node", "server.js"]
