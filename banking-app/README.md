# 🏦 NeoBank — 3-Tier Banking Application

A production-ready 3-tier banking app with:
- **Frontend**: Nginx serving a unique dark-themed UI (HTML/CSS/JS)
- **Backend**: Node.js + Express REST API
- **Database**: PostgreSQL with proper schema, indexes & triggers

## 📁 Project Structure

```
banking-app/
├── frontend/
│   ├── index.html          # Unique dark banking UI
│   ├── nginx.conf          # Nginx reverse-proxy config
│   └── Dockerfile
├── backend/
│   ├── server.js           # Express app entry point
│   ├── db.js               # PostgreSQL connection pool
│   ├── routes/
│   │   ├── accounts.js     # Create & fetch accounts
│   │   └── transactions.js # Deposit & balance check
│   ├── package.json
│   ├── .env
│   └── Dockerfile
├── database/
│   └── init.sql            # Schema, triggers, indexes
├── k8s/
│   ├── 00-namespace.yaml
│   ├── 01-secrets-config.yaml
│   ├── 02-postgres.yaml    # StatefulSet + PVC
│   ├── 03-backend.yaml     # Deployment + HPA
│   └── 04-frontend.yaml    # Deployment + Ingress
├── docker-compose.yml      # Local development
└── deploy.sh               # One-command deploy script
```

## 🚀 Quick Start

### Option 1 — Docker Compose (Local Dev)

```bash
# Start everything
./deploy.sh local

# Or manually:
docker-compose up --build -d

# Access
# Frontend:  http://localhost:3000
# API:       http://localhost:5000
# Health:    http://localhost:5000/health
```

### Option 2 — Kubernetes

```bash
# 1. Set your registry
export REGISTRY=docker.io/youruser
export TAG=v1.0.0

# 2. Edit domain in k8s/04-frontend.yaml
#    Change: banking.yourdomain.com

# 3. Deploy
./deploy.sh k8s

# 4. For Minikube (no domain needed):
minikube addons enable ingress
minikube service banking-frontend-service -n banking
```

### Minikube Quick Deploy

```bash
# Start Minikube
minikube start --memory=4096 --cpus=2

# Point Docker to Minikube's registry
eval $(minikube docker-env)

# Build images
docker build -t banking-backend:latest ./backend
docker build -t banking-frontend:latest ./frontend

# Edit k8s/03-backend.yaml and 04-frontend.yaml:
#   Change image to: banking-backend:latest (no registry prefix)
#   Add: imagePullPolicy: Never

# Deploy
kubectl apply -f k8s/

# Get URL
minikube service banking-frontend-service -n banking
```

## 🔌 API Reference

### Create Account
```
POST /api/accounts
{
  "full_name": "Priya Sharma",
  "email": "priya@example.com",
  "phone": "+91 98765 43210",
  "account_type": "SAVINGS",
  "initial_deposit": 5000
}
```

### Deposit Money
```
POST /api/transactions/deposit
{
  "account_identifier": "ACC123456789",  // or email
  "amount": 1000,
  "description": "Salary"
}
```

### Check Balance
```
GET /api/transactions/balance/ACC123456789
GET /api/transactions/balance/priya@example.com
```

### Get Account Details
```
GET /api/accounts/ACC123456789
GET /api/accounts/priya@example.com
```

### Transaction History
```
GET /api/transactions/ACC123456789
```

## 🗄️ Database Schema

```
accounts
├── id (UUID, PK)
├── account_number (auto-generated: ACC + 9 digits)
├── full_name
├── email (unique)
├── phone
├── balance (NUMERIC, non-negative)
├── account_type (SAVINGS | CURRENT)
├── status (ACTIVE | INACTIVE)
└── created_at / updated_at

transactions
├── id (UUID, PK)
├── account_id (FK → accounts)
├── type (CREDIT | DEBIT)
├── amount
├── description
├── balance_after
└── created_at
```

## 🔒 Security Features

- Helmet.js for HTTP headers
- Rate limiting (100 req/15min)
- Input validation with Joi
- Non-root Docker containers
- K8s Secrets for credentials
- DB connection with retry logic
- SQL injection prevention (parameterized queries)
- CORS configuration

## 📦 Docker Images

```bash
# Build
docker build -t banking-backend:latest ./backend
docker build -t banking-frontend:latest ./frontend

# Run standalone
docker run -p 5000:5000 --env-file ./backend/.env banking-backend:latest
docker run -p 3000:80 banking-frontend:latest
```

## ⚙️ Environment Variables

| Variable     | Default         | Description              |
|-------------|-----------------|--------------------------|
| DB_HOST     | postgres-service| PostgreSQL host          |
| DB_PORT     | 5432            | PostgreSQL port          |
| DB_NAME     | bankingdb       | Database name            |
| DB_USER     | bankuser        | Database user            |
| DB_PASSWORD | bankpass        | Database password        |
| PORT        | 5000            | Backend server port      |
| NODE_ENV    | production      | Environment              |
