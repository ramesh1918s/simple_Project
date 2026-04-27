# 🏦 NeoBank — 3-Tier Banking Application on AWS EKS

## Complete Setup Guide: From Zero to Production

---

## 📁 Project Structure

```
simple_Project/
├── README.md
├── deploy.sh                    # Build & deploy script
├── docker-compose.yml           # Local development
├── backend/
│   ├── Dockerfile
│   ├── server.js                # Express app entry point
│   ├── db.js                    # PostgreSQL connection pool
│   ├── package.json
│   └── routes/
│       ├── accounts.js          # Account CRUD APIs
│       └── transactions.js      # Deposit & balance APIs
├── frontend/
│   ├── Dockerfile
│   ├── index.html               # Single-page app
│   └── nginx.conf               # Nginx reverse proxy config
├── database/
│   └── init.sql                 # DB schema (used in Docker Compose)
└── k8s/
    ├── 00-namespace.yaml        # banking namespace
    ├── 01-configmap.yaml        # DB host, port, name env vars
    ├── 02-secret.yaml           # DB user/password (base64)
    ├── 03-postgres.yaml         # StatefulSet + PVC + headless Service
    ├── 04-backend.yaml          # Deployment + ClusterIP Service
    └── 05-frontend.yaml         # Deployment + LoadBalancer Service
```

---

## 🏗️ Architecture

```
Internet
   │
   ▼
AWS NLB (LoadBalancer)
   │  port 80
   ▼
banking-frontend (nginx)         ← Deployment, 1 replica
   │  /api/* → strips /api → proxy_pass :5000
   ▼
banking-backend (Node.js)        ← Deployment, 1 replica
   │  /api/accounts
   │  /api/transactions
   ▼
postgres-0 (PostgreSQL 16)       ← StatefulSet, 1 replica
   │  EBS gp2 volume (5Gi)
   ▼
AWS EBS PersistentVolume
```

---

## 🔧 Prerequisites

### Tools to Install

```bash
# 1. AWS CLI
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install
aws --version

# 2. kubectl
curl -LO "https://dl.k8s.io/release/$(curl -sL https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
chmod +x kubectl
sudo mv kubectl /usr/local/bin/
kubectl version --client

# 3. eksctl
curl --silent --location "https://github.com/weaveworks/eksctl/releases/latest/download/eksctl_$(uname -s)_amd64.tar.gz" | tar xz -C /tmp
sudo mv /tmp/eksctl /usr/local/bin/
eksctl version

# 4. Docker
sudo apt-get update
sudo apt-get install -y docker.io
sudo usermod -aG docker $USER
docker --version
```

### AWS CLI Configuration

```bash
aws configure
# AWS Access Key ID: <your-key>
# AWS Secret Access Key: <your-secret>
# Default region: ap-south-1
# Default output format: json

# Verify
aws sts get-caller-identity
```

---

## ☸️ EKS Cluster Setup

### Create EKS Cluster

```bash
eksctl create cluster \
  --name banking-eks-cluster \
  --region ap-south-1 \
  --nodegroup-name banking-nodes \
  --node-type t3.small \
  --nodes 2 \
  --nodes-min 2 \
  --nodes-max 4 \
  --managed

# Takes ~15-20 minutes
# Automatically updates ~/.kube/config
```

### Verify Cluster

```bash
kubectl get nodes
kubectl get nodes --show-labels
kubectl cluster-info
```

---

## 💾 EBS CSI Driver Setup (Critical for PersistentVolumes)

### Why This Is Needed
Modern EKS requires the EBS CSI driver to provision EBS volumes for PersistentVolumeClaims.
Without it, postgres PVCs stay in `Pending` forever.

### Step 1 — Install the addon

```bash
aws eks create-addon \
  --cluster-name banking-eks-cluster \
  --addon-name aws-ebs-csi-driver \
  --resolve-conflicts OVERWRITE \
  --region ap-south-1
```

### Step 2 — Get OIDC Provider ID

```bash
aws eks describe-cluster \
  --name banking-eks-cluster \
  --region ap-south-1 \
  --query "cluster.identity.oidc.issuer" \
  --output text
# Output: https://oidc.eks.ap-south-1.amazonaws.com/id/XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
# Copy only the hash at the end: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

### Step 3 — Create IAM Role for EBS CSI

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
OIDC_ID="XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"   # ← paste your hash here

cat > /tmp/ebs-trust-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::${ACCOUNT_ID}:oidc-provider/oidc.eks.ap-south-1.amazonaws.com/id/${OIDC_ID}"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "oidc.eks.ap-south-1.amazonaws.com/id/${OIDC_ID}:sub": "system:serviceaccount:kube-system:ebs-csi-controller-sa",
          "oidc.eks.ap-south-1.amazonaws.com/id/${OIDC_ID}:aud": "sts.amazonaws.com"
        }
      }
    }
  ]
}
EOF

# Create the IAM role
aws iam create-role \
  --role-name AmazonEKS_EBS_CSI_DriverRole \
  --assume-role-policy-document file:///tmp/ebs-trust-policy.json

# Attach EBS policy
aws iam attach-role-policy \
  --role-name AmazonEKS_EBS_CSI_DriverRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy
```

### Step 4 — Annotate Service Account

```bash
kubectl annotate serviceaccount ebs-csi-controller-sa \
  -n kube-system \
  eks.amazonaws.com/role-arn=arn:aws:iam::${ACCOUNT_ID}:role/AmazonEKS_EBS_CSI_DriverRole \
  --overwrite
```

### Step 5 — Restart CSI Controller

```bash
kubectl rollout restart deployment ebs-csi-controller -n kube-system

# Wait and verify — all pods should show 6/6 Running
kubectl get pods -n kube-system | grep ebs
```

Expected output:
```
ebs-csi-controller-xxxx   6/6   Running   0   30s
ebs-csi-controller-xxxx   6/6   Running   0   30s
ebs-csi-node-xxxx         3/3   Running   0   5m
ebs-csi-node-xxxx         3/3   Running   0   5m
```

---

## 🐳 Docker Images

### Build and Push

```bash
# Backend
docker build -t shivaram1918/banking-backend:latest ./backend
docker push shivaram1918/banking-backend:latest

# Frontend
docker build -t shivaram1918/banking-frontend:latest ./frontend
docker push shivaram1918/banking-frontend:latest
```

---

## 🚀 Deploy to Kubernetes

### Apply All Manifests in Order

```bash
cd simple_Project/

kubectl apply -f k8s/00-namespace.yaml
kubectl apply -f k8s/01-configmap.yaml
kubectl apply -f k8s/02-secret.yaml
kubectl apply -f k8s/03-postgres.yaml
kubectl apply -f k8s/04-backend.yaml
kubectl apply -f k8s/05-frontend.yaml
```

### Watch Pods Come Up

```bash
kubectl get pods -n banking -w
```

Expected final state:
```
NAME                                READY   STATUS    RESTARTS   AGE
banking-backend-xxxx                1/1     Running   0          2m
banking-frontend-xxxx               1/1     Running   0          2m
postgres-0                          1/1     Running   0          3m
```

### Get App URL

```bash
kubectl get svc banking-frontend-service -n banking
# Copy the EXTERNAL-IP — that's your app URL
```

---

## 🗄️ Database Setup

### Why Tables Are Not Auto-Created
The backend has no migration runner. Tables must be created manually once postgres is running.

### Connect to PostgreSQL

```bash
# Enter psql shell
kubectl exec -it -n banking postgres-0 -- psql -U bankuser -d bankingdb
```

### Create Tables (run inside psql)

```sql
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Accounts table
CREATE TABLE IF NOT EXISTS accounts (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_number VARCHAR(20) UNIQUE NOT NULL DEFAULT '',
  full_name      VARCHAR(100) NOT NULL,
  email          VARCHAR(100) UNIQUE NOT NULL,
  phone          VARCHAR(20),
  account_type   VARCHAR(20) DEFAULT 'SAVINGS',
  balance        DECIMAL(15,2) DEFAULT 0.00,
  status         VARCHAR(20) DEFAULT 'ACTIVE',
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Auto-generate account number on insert
CREATE OR REPLACE FUNCTION generate_account_number()
RETURNS TRIGGER AS $$
BEGIN
  NEW.account_number := 'ACC' || LPAD(FLOOR(RANDOM() * 9000000 + 1000000)::TEXT, 7, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_account_number
BEFORE INSERT ON accounts
FOR EACH ROW
WHEN (NEW.account_number = '' OR NEW.account_number IS NULL)
EXECUTE FUNCTION generate_account_number();

-- Transactions table
CREATE TABLE IF NOT EXISTS transactions (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id   UUID REFERENCES accounts(id),
  type         VARCHAR(20) NOT NULL,
  amount       DECIMAL(15,2) NOT NULL,
  description  TEXT,
  balance_after DECIMAL(15,2),
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Verify
\dt
```

### Exit psql

```bash
\q
```

---

## 🔍 Database Query Commands

### Check Tables

```bash
kubectl exec -it -n banking postgres-0 -- psql -U bankuser -d bankingdb
```

```sql
-- List all tables
\dt

-- Describe table structure
\d accounts
\d transactions

-- List all accounts
SELECT id, account_number, full_name, email, account_type, balance, status, created_at
FROM accounts
ORDER BY created_at DESC;

-- List all transactions
SELECT t.id, a.account_number, a.full_name, t.type, t.amount, t.description, t.balance_after, t.created_at
FROM transactions t
JOIN accounts a ON t.account_id = a.id
ORDER BY t.created_at DESC;

-- Account summary
SELECT
  COUNT(*) as total_accounts,
  SUM(balance) as total_balance,
  AVG(balance) as avg_balance
FROM accounts;

-- Transaction summary
SELECT type, COUNT(*) as count, SUM(amount) as total
FROM transactions
GROUP BY type;

-- Check specific account by email
SELECT * FROM accounts WHERE email = 'your@email.com';

-- Check balance for account
SELECT account_number, full_name, balance, status
FROM accounts
WHERE account_number = 'ACC1234567';

-- Recent transactions for an account
SELECT t.*
FROM transactions t
JOIN accounts a ON t.account_id = a.id
WHERE a.email = 'your@email.com'
ORDER BY t.created_at DESC
LIMIT 10;
```

---

## 🔧 Useful kubectl Commands

### Pod Management

```bash
# Check all pods
kubectl get pods -n banking

# Watch pods live
kubectl get pods -n banking -w

# Describe a pod (for troubleshooting)
kubectl describe pod <pod-name> -n banking

# Get pod logs
kubectl logs -n banking deployment/banking-backend --tail=50
kubectl logs -n banking deployment/banking-frontend --tail=50
kubectl logs -n banking postgres-0 --tail=50

# Follow logs live
kubectl logs -n banking deployment/banking-backend -f

# Execute command in pod
kubectl exec -it -n banking <pod-name> -- /bin/sh
```

### Service & Networking

```bash
# Check all services
kubectl get svc -n banking

# Get LoadBalancer URL
kubectl get svc banking-frontend-service -n banking

# Check endpoints
kubectl get endpoints -n banking
```

### Storage

```bash
# Check PersistentVolumeClaims
kubectl get pvc -n banking

# Check PersistentVolumes
kubectl get pv

# Check StorageClasses
kubectl get storageclass

# Describe PVC (for pending issues)
kubectl describe pvc postgres-storage-postgres-0 -n banking
```

### Deployment Management

```bash
# Restart deployment (rolling restart)
kubectl rollout restart deployment/banking-backend -n banking
kubectl rollout restart deployment/banking-frontend -n banking

# Check rollout status
kubectl rollout status deployment/banking-backend -n banking

# Scale deployment
kubectl scale deployment banking-backend --replicas=2 -n banking

# Check HPA
kubectl get hpa -n banking
```

### Debugging

```bash
# Check events in namespace
kubectl get events -n banking --sort-by='.lastTimestamp'

# Check resource usage
kubectl top pods -n banking
kubectl top nodes

# Check configmap values
kubectl get configmap banking-config -n banking -o yaml

# Check secret (base64 encoded)
kubectl get secret banking-secrets -n banking -o yaml
```

---

## 🌐 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/accounts` | Create new account |
| GET | `/api/accounts` | List all accounts |
| GET | `/api/accounts/:identifier` | Get account by number/email/id |
| POST | `/api/transactions/deposit` | Deposit money |
| GET | `/api/transactions/balance/:identifier` | Check balance |
| GET | `/api/transactions/:identifier` | Transaction history |
| GET | `/health` | Health check |

### Test API Directly

```bash
# Get LoadBalancer URL
LB=$(kubectl get svc banking-frontend-service -n banking -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')

# Health check
curl http://$LB/health

# Create account
curl -X POST http://$LB/api/accounts \
  -H "Content-Type: application/json" \
  -d '{"full_name":"Test User","email":"test@example.com","phone":"+919876543210","account_type":"SAVINGS","initial_deposit":5000}'

# Check balance
curl http://$LB/api/transactions/balance/test@example.com

# Deposit money
curl -X POST http://$LB/api/transactions/deposit \
  -H "Content-Type: application/json" \
  -d '{"account_identifier":"test@example.com","amount":1000,"description":"Test deposit"}'
```

---

## 🚨 Troubleshooting

### Postgres Pod Pending

```bash
# Check why PVC is pending
kubectl describe pvc postgres-storage-postgres-0 -n banking
kubectl get events -n banking

# Common causes:
# 1. EBS CSI driver not running → fix IAM role (see EBS setup above)
# 2. Wrong storageClassName → must match: kubectl get storageclass
# 3. Node memory full → check: kubectl describe nodes | grep -E "memory|Taints"
```

### Backend CrashLoopBackOff

```bash
# Check logs
kubectl logs -n banking deployment/banking-backend --tail=30

# Common causes:
# 1. Postgres not ready → initContainer wait-for-postgres handles this
# 2. Tables not created → run CREATE TABLE commands above
# 3. Wrong DB credentials → check configmap and secret
```

### 500 Error on API

```bash
# Watch backend logs while testing
kubectl logs -n banking deployment/banking-backend -f

# Common causes:
# 1. Tables don't exist → parserOpenTable error → run CREATE TABLE
# 2. Duplicate account_number='' → add trigger (see DB setup)
# 3. Wrong env vars → kubectl get configmap banking-config -n banking -o yaml
```

### EBS CSI CrashLoopBackOff

```bash
# Check error
kubectl logs -n kube-system -l app=ebs-csi-controller -c csi-provisioner --tail=20

# If AccessDenied → IAM role not attached correctly
# Fix: re-annotate service account with correct role ARN
kubectl annotate serviceaccount ebs-csi-controller-sa \
  -n kube-system \
  eks.amazonaws.com/role-arn=arn:aws:iam::<ACCOUNT_ID>:role/AmazonEKS_EBS_CSI_DriverRole \
  --overwrite
kubectl rollout restart deployment ebs-csi-controller -n kube-system
```

---

## 🧹 Cleanup

```bash
# Delete all app resources
kubectl delete namespace banking

# Delete EKS cluster (stops AWS billing)
eksctl delete cluster --name banking-eks-cluster --region ap-south-1

# Delete IAM role
aws iam detach-role-policy \
  --role-name AmazonEKS_EBS_CSI_DriverRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy
aws iam delete-role --role-name AmazonEKS_EBS_CSI_DriverRole
```

---

## 📦 Secret Values Reference

```bash
# Decode existing secrets
kubectl get secret banking-secrets -n banking -o jsonpath='{.data.DB_USER}' | base64 -d
kubectl get secret banking-secrets -n banking -o jsonpath='{.data.DB_PASSWORD}' | base64 -d

# Generate new base64 values
echo -n "bankuser" | base64    # YmFua3VzZXI=
echo -n "bankpass" | base64    # YmFua3Bhc3M=
```

---

## ✅ Full Deployment Checklist

- [ ] AWS CLI configured with correct credentials
- [ ] eksctl, kubectl, docker installed
- [ ] EKS cluster created (2x t3.small nodes)
- [ ] kubeconfig updated (`aws eks update-kubeconfig`)
- [ ] EBS CSI addon installed
- [ ] OIDC provider set up for cluster
- [ ] IAM role `AmazonEKS_EBS_CSI_DriverRole` created with correct OIDC trust
- [ ] `ebs-csi-controller-sa` annotated with IAM role ARN
- [ ] EBS CSI controller pods showing `6/6 Running`
- [ ] Docker images built and pushed to Docker Hub
- [ ] All k8s manifests applied in order (00 → 05)
- [ ] `postgres-0` pod Running, PVC Bound
- [ ] Database tables created manually via psql
- [ ] Account number trigger created
- [ ] Backend pods Running (1/1)
- [ ] Frontend pods Running (1/1)
- [ ] LoadBalancer EXTERNAL-IP assigned
- [ ] App accessible in browser
- [ ] Account creation working
- [ ] Deposit and balance check working

---

*NeoBank — Built with Node.js, PostgreSQL, nginx, Docker, and AWS EKS*