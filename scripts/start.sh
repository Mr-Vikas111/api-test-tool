#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# ── Help ─────────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "Usage: ./scripts/start.sh [options]"
  echo ""
  echo "Options:"
  echo "  --host HOST        Server host (default: \${HOST:-127.0.0.1})"
  echo "  --port PORT        Server port (default: \${PORT:-5055})"
  echo "  --model MODEL      Ollama model override (default: \${MODEL_OLLAMA:-llama3.2})"
  echo "  --provider PROVIDER LLM provider: ollama|openai (default: \${LLM_PROVIDER:-ollama})"
  echo "  --install          Install dependencies before starting"
  echo "  -h, --help         Show this help"
  echo ""
  echo "Environment variables:"
  echo "  HOST, PORT, MODEL_OLLAMA, LLM_PROVIDER, OPENAI_API_KEY, DATABASE_URL"
  echo "  See .env.example for all supported vars"
  exit 0
fi

# ── Python discovery ─────────────────────────────────────────────────────────
PYTHON_BIN="${PYTHON_BIN:-}"
if [[ -z "$PYTHON_BIN" ]]; then
  if [[ -x "$ROOT_DIR/.venv/bin/python" ]]; then
    PYTHON_BIN="$ROOT_DIR/.venv/bin/python"
  elif command -v python3 &>/dev/null; then
    PYTHON_BIN="$(command -v python3)"
  elif command -v python &>/dev/null; then
    PYTHON_BIN="$(command -v python)"
  else
    echo "Error: Python not found. Set PYTHON_BIN or install Python." >&2
    exit 1
  fi
fi

# ── Install dependencies (optional) ──────────────────────────────────────────
if [[ "${1:-}" == "--install" || "${2:-}" == "--install" || "${3:-}" == "--install" ]]; then
  echo "Installing dependencies..."
  "$PYTHON_BIN" -m pip install --quiet --upgrade pip
  "$PYTHON_BIN" -m pip install --quiet -r requirements.txt
  echo "Dependencies installed."
fi

# ── Load .env if present ─────────────────────────────────────────────────────
if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  source "$ROOT_DIR/.env"
  set +a
fi
export HOST
export PORT
export MODEL_OLLAMA
export LLM_PROVIDER

# ── Ollama health check (only when using ollama) ─────────────────────────────
LLM_PROVIDER="${LLM_PROVIDER:-ollama}"
OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://localhost:11434}"
if [[ "$LLM_PROVIDER" == "ollama" ]]; then
  echo "Checking Ollama at $OLLAMA_BASE_URL ..."
  if ! curl -sf "$OLLAMA_BASE_URL/api/tags" > /dev/null 2>&1; then
    echo "Warning: Cannot reach Ollama at $OLLAMA_BASE_URL"
    echo "  Start it with: ollama serve"
    echo "  Or set:        LLM_PROVIDER=openai"
    echo ""
  else
    echo "Ollama is reachable."
  fi
fi

# ── Start server ─────────────────────────────────────────────────────────────
# Ensure src/ is on Python's module path
export PYTHONPATH="${PYTHONPATH:-}:$ROOT_DIR/src"

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-5055}"
MODEL="${MODEL_OLLAMA:-}"

ARGS=("--host" "$HOST" "--port" "$PORT")
if [[ -n "$MODEL" ]]; then
  ARGS+=("--model" "$MODEL")
fi
if [[ -n "$LLM_PROVIDER" ]]; then
  ARGS+=("--provider" "$LLM_PROVIDER")
fi

echo "Starting AI Test API server at http://$HOST:$PORT"
echo "  LLM provider: $LLM_PROVIDER"
[[ -n "$MODEL" ]] && echo "  Model: $MODEL"
echo ""

exec "$PYTHON_BIN" webhook_server.py "${ARGS[@]}"
