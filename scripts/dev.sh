#!/usr/bin/env bash

set -euo pipefail
set -m

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

API_PORT="${API_PORT:-8787}"
DB_PATH="${RUNWIRE_DB:-}"
IMPORT_FIRST=false
LABELS=()
PIDS=()
DOWN=0

usage() {
  cat <<'EOF'
Usage: scripts/dev.sh [options]

  --port <n>      port for @runwire/server (default: 8787)
  --db <path>     SQLite file for `runwire serve` (default: ~/.runwire/runwire.db)
  --import        run `runwire import` once before starting the servers
  --no-color      plain [api]/[web] prefixes
  -h, --help      this message

Env: API_PORT, RUNWIRE_DB. The Vite dev URL stays http://localhost:5173.
EOF
}

die() {
  echo "error: $*" >&2
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
  --port)
    [[ $# -ge 2 ]] || die "--port needs a value"
    API_PORT="$2"
    shift 2
    ;;
  --db)
    [[ $# -ge 2 ]] || die "--db needs a value"
    DB_PATH="$2"
    shift 2
    ;;
  --import)
    IMPORT_FIRST=true
    shift
    ;;
  --no-color)
    NO_COLOR=1
    shift
    ;;
  -h | --help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    die "unknown option \"$1\""
    ;;
  esac
done

[[ "$API_PORT" =~ ^[0-9]+$ ]] || die "--port must be a number, got \"$API_PORT\""

command -v bun >/dev/null 2>&1 || die "bun is required — https://bun.sh"

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  C_API=$'\033[36m'
  C_WEB=$'\033[35m'
  C_DIM=$'\033[2m'
  NC=$'\033[0m'
else
  C_API='' C_WEB='' C_DIM='' NC=''
fi

say() { printf '%s\n' "${C_DIM}$*${NC}"; }

launch() {
  local label="$1" color="$2" cwd="$3" prefix
  shift 3
  prefix="${color}[$label]${NC} "
  (cd "$cwd" && exec "$@") > >(sed -u "s|^|${prefix}|") 2>&1 &
  LABELS+=("$label")
  PIDS+=("$!")
}

down() {
  [[ "$DOWN" == 1 ]] && return
  DOWN=1
  trap - INT TERM EXIT
  local pid
  for pid in "${PIDS[@]:-}"; do
    [[ -n "$pid" ]] || continue
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM -- "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  say "stopped"
}

trap 'down; exit 130' INT
trap 'down; exit 143' TERM
trap down EXIT

if [[ ! -d "$ROOT/node_modules" || ! -d "$ROOT/packages/web/node_modules" ]]; then
  say "installing workspace dependencies"
  (cd "$ROOT" && bun install)
fi

if [[ "$IMPORT_FIRST" == true ]]; then
  say "importing sessions"
  (cd "$ROOT" && bun run runwire import)
fi

serve_args=(serve --port "$API_PORT")
if [[ -n "$DB_PATH" ]]; then
  serve_args+=(--db "$DB_PATH")
fi

if [[ "$API_PORT" != 8787 ]]; then
  say "note: packages/web/vite.config.ts proxies /api to 127.0.0.1:8787 — point it at $API_PORT too, or /api will 502"
fi

launch api "$C_API" "$ROOT" bun run runwire "${serve_args[@]}"
launch web "$C_WEB" "$ROOT/packages/web" bun run dev

say "${C_API}api${NC} http://127.0.0.1:${API_PORT}  ${C_DIM}|${NC}  ${C_WEB}web${NC} http://localhost:5173  ${C_DIM}|${NC}  Ctrl-C stops both"

while :; do
  i=0
  while [[ "$i" -lt "${#PIDS[@]}" ]]; do
    pid="${PIDS[$i]}"
    if ! kill -0 -- "$pid" 2>/dev/null; then
      say "the ${LABELS[$i]} process exited — stopping the rest"
      exit 1
    fi
    i=$((i + 1))
  done
  sleep 0.5
done
