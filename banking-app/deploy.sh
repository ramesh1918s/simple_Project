#!/bin/bash
# ============================================================
#  NeoBank — Build & Deploy Script
#  Usage: ./deploy.sh [local|k8s|build-only]
# ============================================================
set -e

REGISTRY="${REGISTRY:-your-registry}"       # e.g. docker.io/youruser
TAG="${TAG:-latest}"
BACKEND_IMAGE="${REGISTRY}/banking-backend:${TAG}"
FRONTEND_IMAGE="${REGISTRY}/banking-frontend:${TAG}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${GREEN}[✓] $1${NC}"; }
info() { echo -e "${BLUE}[→] $1${NC}"; }
warn() { echo -e "${YELLOW}[!] $1${NC}"; }
err()  { echo -e "${RED}[✗] $1${NC}"; exit 1; }

# ── Build Images ────────────────────────────────────────────
build_images() {
  info "Building backend image: ${BACKEND_IMAGE}"
  docker build -t "${BACKEND_IMAGE}" ./backend
  log "Backend image built"

  info "Building frontend image: ${FRONTEND_IMAGE}"
  docker build -t "${FRONTEND_IMAGE}" ./frontend
  log "Frontend image built"
}

# ── Push Images ─────────────────────────────────────────────
push_images() {
  info "Pushing images to registry..."
  docker push "${BACKEND_IMAGE}"
  docker push "${FRONTEND_IMAGE}"
  log "Images pushed"
}

# ── Local Dev (Docker Compose) ───────────────────────────────
deploy_local() {
  info "Starting local environment with Docker Compose..."
  docker-compose up --build -d
  echo ""
  log "Services started!"
  echo -e "  ${BLUE}Frontend:${NC}  http://localhost:3000"
  echo -e "  ${BLUE}Backend:${NC}   http://localhost:5000"
  echo -e "  ${BLUE}API Docs:${NC}  http://localhost:5000/health"
  echo ""
  warn "Run 'docker-compose logs -f' to follow logs"
}

# ── Kubernetes Deploy ────────────────────────────────────────
deploy_k8s() {
  command -v kubectl >/dev/null 2>&1 || err "kubectl not found. Install it first."

  info "Deploying to Kubernetes..."

  # Update image references in manifests
  sed -i "s|your-registry/banking-backend:latest|${BACKEND_IMAGE}|g" k8s/03-backend.yaml
  sed -i "s|your-registry/banking-frontend:latest|${FRONTEND_IMAGE}|g" k8s/04-frontend.yaml

  kubectl apply -f k8s/00-namespace.yaml
  kubectl apply -f k8s/01-secrets-config.yaml
  kubectl apply -f k8s/02-postgres.yaml
  info "Waiting for PostgreSQL to be ready..."
  kubectl rollout status statefulset/postgres -n banking --timeout=120s
  kubectl apply -f k8s/03-backend.yaml
  info "Waiting for backend to be ready..."
  kubectl rollout status deployment/banking-backend -n banking --timeout=120s
  kubectl apply -f k8s/04-frontend.yaml
  info "Waiting for frontend to be ready..."
  kubectl rollout status deployment/banking-frontend -n banking --timeout=60s

  echo ""
  log "Kubernetes deployment complete!"
  echo ""
  kubectl get pods -n banking
  echo ""
  warn "Update k8s/04-frontend.yaml with your domain before Ingress goes live."
  warn "For Minikube: run 'minikube service banking-frontend-service -n banking'"
}

# ── Status ───────────────────────────────────────────────────
status() {
  info "Pod status in banking namespace:"
  kubectl get pods,svc,ingress -n banking
}

# ── Main ─────────────────────────────────────────────────────
case "${1:-local}" in
  local)       build_images && deploy_local ;;
  k8s)         build_images && push_images && deploy_k8s ;;
  build-only)  build_images ;;
  push-only)   push_images ;;
  status)      status ;;
  *)
    echo "Usage: $0 [local|k8s|build-only|push-only|status]"
    echo ""
    echo "  local       — Build and run with Docker Compose"
    echo "  k8s         — Build, push, and deploy to Kubernetes"
    echo "  build-only  — Build Docker images only"
    echo "  push-only   — Push images to registry"
    echo "  status      — Show K8s pod status"
    exit 1
    ;;
esac
