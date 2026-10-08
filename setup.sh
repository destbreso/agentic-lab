#!/usr/bin/env bash
# ===========================================================
# Agentic Lab — Quick Setup Script
# ===========================================================
# Gets everything running in seconds.
# Usage: ./setup.sh [--full | --dev | --minimal]
#
# Modes:
#   --full     All services (PostgreSQL, Redis, Qdrant, Prometheus, Grafana)
#   --dev      Essential services only (PostgreSQL, Redis, Qdrant)
#   --minimal  No infrastructure (in-memory storage)
#
# Default: --dev
# ===========================================================

set -euo pipefail

# ───── Colors ─────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
GRAY='\033[0;90m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# ───── Helpers ─────
info()    { echo -e "${CYAN}ℹ ${NC}$1"; }
success() { echo -e "${GREEN}✅ ${NC}$1"; }
warn()    { echo -e "${YELLOW}⚠️  ${NC}$1"; }
error()   { echo -e "${RED}❌ ${NC}$1"; }
step()    { echo -e "\n${BOLD}${CYAN}── $1 ──${NC}"; }

# ───── Parse mode ─────
MODE="${1:---dev}"

case "$MODE" in
  --full)       MODE_LABEL="Full Stack (all services)" ;;
  --dev)        MODE_LABEL="Development (essential services)" ;;
  --minimal)    MODE_LABEL="Minimal (no infrastructure)" ;;
  --help|-h)
    echo ""
    echo "Usage: ./setup.sh [--full | --dev | --minimal]"
    echo ""
    echo "  --full     All services (PostgreSQL, Redis, Qdrant, Prometheus, Grafana)"
    echo "  --dev      Essential services only (PostgreSQL, Redis, Qdrant) [default]"
    echo "  --minimal  No infrastructure (in-memory storage only)"
    echo ""
    exit 0
    ;;
  *)
    error "Unknown mode: $MODE"
    echo "Usage: ./setup.sh [--full | --dev | --minimal]"
    exit 1
    ;;
esac

echo ""
echo -e "${BOLD}🤖 Agentic Lab — Quick Setup${NC}"
echo -e "${GRAY}   Mode: ${MODE_LABEL}${NC}"
echo ""

# ───── Step 1: Prerequisites ─────
step "Checking prerequisites"

# Node.js
if ! command -v node &>/dev/null; then
  error "Node.js is not installed. Install it from https://nodejs.org (v20+)"
  exit 1
fi
NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  error "Node.js v20+ required (found v$(node -v))"
  exit 1
fi
success "Node.js $(node -v)"

# npm
if ! command -v npm &>/dev/null; then
  error "npm is not installed"
  exit 1
fi
success "npm $(npm -v)"

# Docker (unless minimal)
if [ "$MODE" != "--minimal" ]; then
  if ! command -v docker &>/dev/null; then
    error "Docker is not installed. Install Docker Desktop from https://docker.com"
    echo ""
    echo -e "  ${GRAY}Or run with --minimal mode (no infrastructure):${NC}"
    echo -e "  ${GRAY}  ./setup.sh --minimal${NC}"
    echo ""
    exit 1
  fi
  
  # Check if Docker daemon is running
  if ! docker info &>/dev/null 2>&1; then
    error "Docker daemon is not running. Start Docker Desktop first."
    exit 1
  fi
  success "Docker $(docker --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')"
  
  # Docker Compose
  if ! docker compose version &>/dev/null 2>&1; then
    error "Docker Compose V2 not available. Update Docker Desktop."
    exit 1
  fi
  success "Docker Compose $(docker compose version --short)"
fi

# ───── Step 2: Environment ─────
step "Setting up environment"

if [ ! -f ".env" ]; then
  cp .env.example .env
  success "Created .env from template"
  info "Edit .env to add your API keys (optional for Ollama)"
else
  success ".env already exists"
fi

# ───── Step 3: Install dependencies ─────
step "Installing dependencies"

npm install --loglevel warn 2>&1 | tail -1
success "Dependencies installed"

# ───── Step 4: Build packages ─────
step "Building packages"

echo -ne "  ${GRAY}Building core...${NC}"
npm run build:core --silent 2>&1 > /dev/null
echo -e "\r  ${GREEN}✅${NC} @agentic-lab/core"

echo -ne "  ${GRAY}Building CLI...${NC}"
npm run build:cli --silent 2>&1 > /dev/null
echo -e "\r  ${GREEN}✅${NC} @agentic-lab/cli"

echo -ne "  ${GRAY}Building web...${NC}"
npm run build:web --silent 2>&1 > /dev/null
echo -e "\r  ${GREEN}✅${NC} @agentic-lab/web"

success "All packages built"

# ───── Step 5: Infrastructure ─────
if [ "$MODE" != "--minimal" ]; then
  step "Starting infrastructure"
  
  if [ "$MODE" = "--full" ]; then
    docker compose up -d 2>&1 | grep -v "^$"
  else
    # Dev mode: essential services only
    docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d 2>&1 | grep -v "^$"
  fi
  
  # Wait for services to be healthy
  echo ""
  info "Waiting for services to be healthy..."
  
  MAX_WAIT=30
  WAITED=0
  
  # Wait for PostgreSQL
  echo -ne "  ${GRAY}PostgreSQL...${NC}"
  while ! docker exec alab-postgres pg_isready -U agentic &>/dev/null 2>&1; do
    sleep 1
    WAITED=$((WAITED + 1))
    if [ "$WAITED" -ge "$MAX_WAIT" ]; then
      echo -e "\r  ${RED}❌${NC} PostgreSQL (timeout after ${MAX_WAIT}s)"
      break
    fi
  done
  if [ "$WAITED" -lt "$MAX_WAIT" ]; then
    echo -e "\r  ${GREEN}✅${NC} PostgreSQL  → localhost:${POSTGRES_PORT:-5432}"
  fi
  
  # Wait for Redis
  WAITED=0
  echo -ne "  ${GRAY}Redis...${NC}"
  while ! docker exec alab-redis redis-cli ping &>/dev/null 2>&1; do
    sleep 1
    WAITED=$((WAITED + 1))
    if [ "$WAITED" -ge "$MAX_WAIT" ]; then
      echo -e "\r  ${RED}❌${NC} Redis (timeout after ${MAX_WAIT}s)"
      break
    fi
  done
  if [ "$WAITED" -lt "$MAX_WAIT" ]; then
    echo -e "\r  ${GREEN}✅${NC} Redis       → localhost:${REDIS_PORT:-6379}"
  fi
  
  # Wait for Qdrant
  WAITED=0
  echo -ne "  ${GRAY}Qdrant...${NC}"
  while ! curl -sf http://localhost:${QDRANT_PORT:-6333}/healthz &>/dev/null 2>&1; do
    sleep 1
    WAITED=$((WAITED + 1))
    if [ "$WAITED" -ge "$MAX_WAIT" ]; then
      echo -e "\r  ${RED}❌${NC} Qdrant (timeout after ${MAX_WAIT}s)"
      break
    fi
  done
  if [ "$WAITED" -lt "$MAX_WAIT" ]; then
    echo -e "\r  ${GREEN}✅${NC} Qdrant      → localhost:${QDRANT_PORT:-6333}"
  fi
  
  # Full mode extras
  if [ "$MODE" = "--full" ]; then
    WAITED=0
    echo -ne "  ${GRAY}Prometheus...${NC}"
    while ! curl -sf http://localhost:${PROMETHEUS_PORT:-9090}/-/ready &>/dev/null 2>&1; do
      sleep 1
      WAITED=$((WAITED + 1))
      if [ "$WAITED" -ge "$MAX_WAIT" ]; then
        echo -e "\r  ${YELLOW}⚠️ ${NC} Prometheus (timeout — may still be starting)"
        break
      fi
    done
    if [ "$WAITED" -lt "$MAX_WAIT" ]; then
      echo -e "\r  ${GREEN}✅${NC} Prometheus  → localhost:${PROMETHEUS_PORT:-9090}"
    fi
    
    WAITED=0
    echo -ne "  ${GRAY}Grafana...${NC}"
    while ! curl -sf http://localhost:${GRAFANA_PORT:-3001}/api/health &>/dev/null 2>&1; do
      sleep 1
      WAITED=$((WAITED + 1))
      if [ "$WAITED" -ge "$MAX_WAIT" ]; then
        echo -e "\r  ${YELLOW}⚠️ ${NC} Grafana (timeout — may still be starting)"
        break
      fi
    done
    if [ "$WAITED" -lt "$MAX_WAIT" ]; then
      echo -e "\r  ${GREEN}✅${NC} Grafana     → localhost:${GRAFANA_PORT:-3001} (admin / agentic_lab)"
    fi
  fi
  
  echo ""
  success "Infrastructure running"
fi

# ───── Step 6: Verify ─────
step "Verification"

if [ "$MODE" != "--minimal" ]; then
  # Quick connectivity test
  if docker exec alab-postgres psql -U agentic -d agentic_lab -c "SELECT count(*) FROM runs;" &>/dev/null 2>&1; then
    success "Database schema initialized (tables ready)"
  else
    warn "Database schema may need a moment to initialize"
  fi
fi

# ───── Summary ─────
echo ""
echo -e "${BOLD}${GREEN}══════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}  🎉 Agentic Lab is ready!${NC}"
echo -e "${BOLD}${GREEN}══════════════════════════════════════════${NC}"
echo ""

if [ "$MODE" = "--full" ]; then
  echo -e "  ${BOLD}Services:${NC}"
  echo -e "  ${GRAY}├─${NC} PostgreSQL    → localhost:${POSTGRES_PORT:-5432}"
  echo -e "  ${GRAY}├─${NC} Redis         → localhost:${REDIS_PORT:-6379}"
  echo -e "  ${GRAY}├─${NC} Qdrant        → localhost:${QDRANT_PORT:-6333}"
  echo -e "  ${GRAY}├─${NC} Prometheus    → http://localhost:${PROMETHEUS_PORT:-9090}"
  echo -e "  ${GRAY}└─${NC} Grafana       → http://localhost:${GRAFANA_PORT:-3001} ${GRAY}(admin / agentic_lab)${NC}"
  echo ""
fi

if [ "$MODE" = "--dev" ]; then
  echo -e "  ${BOLD}Services:${NC}"
  echo -e "  ${GRAY}├─${NC} PostgreSQL    → localhost:${POSTGRES_PORT:-5432}"
  echo -e "  ${GRAY}├─${NC} Redis         → localhost:${REDIS_PORT:-6379}"
  echo -e "  ${GRAY}└─${NC} Qdrant        → localhost:${QDRANT_PORT:-6333}"
  echo ""
fi

echo -e "  ${BOLD}Next steps:${NC}"
echo ""
echo -e "  ${CYAN}1.${NC} Start the web dashboard:"
echo -e "     ${GRAY}npm run dev:web${NC}"
echo ""
echo -e "  ${CYAN}2.${NC} Initialize a workspace in your project (link the CLI once first):"
echo -e "     ${GRAY}(cd packages/cli && npm link)${NC}"
echo -e "     ${GRAY}cd your-project && agentic-lab init${NC}"
echo ""
echo -e "  ${CYAN}3.${NC} Run an agentic loop:"
echo -e "     ${GRAY}agentic-lab run --provider ollama --model llama3.1${NC}"
echo ""

if [ "$MODE" = "--full" ]; then
  echo -e "  ${CYAN}4.${NC} View dashboards:"
  echo -e "     ${GRAY}open http://localhost:${GRAFANA_PORT:-3001}${NC}"
  echo ""
fi

echo -e "  ${GRAY}Need help? See docs/QUICKSTART.md for troubleshooting${NC}"
echo ""
