#!/usr/bin/env bash
#
# scout dev — brings up the whole app from the repo root:
#   [api] @scout/server  via `bun run scout serve` (default 127.0.0.1:8787)
#   [web] @scout/web     via Vite dev server (its /api proxy targets that port)
#
# Both run as children, every line they print is prefixed, and one Ctrl-C
# (or SIGTERM) takes the pair down. If either dies, the other is stopped too.
# Written for bash 3.2, the macOS default.

set -euo pipefail
set -m # each child gets its own process group, so teardown can kill the group

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

API_PORT="${API_PORT:-8787}" # keep in sync with the /api proxy in packages/web/vite.config.ts
DB_PATH="${SCOUT_DB:-}"
IMPORT_FIRST=false
LABELS=()
PIDS=()
DOWN=0

usage() {
  cat <<'EOF'
Usage: scripts/dev.sh [options]

  --port <n>      port for @scout/server (default: 8787)
  --db <path>     SQLite file for `scout serve` (default: ~/.scout/scout.db)
  --import        run `scout import` once before starting the servers
  --no-color      plain [api]/[web] prefixes
  -h, --help      this message

Env: API_PORT, SCOUT_DB. The Vite dev URL stays http://localhost:5173.
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

# launch <label> <color> <cwd> <cmd> [args...] — child stdout+stderr, line-prefixed.
# Prefixing goes through process substitution so $! stays the child's own pid:
# a plain `cmd | sed &` pipeline would report sed as the job and leave the child alive.
launch() {
  local label="$1" color="$2" cwd="$3" prefix
  shift 3
  prefix="${color}[$label]${NC} "
  (cd "$cwd" && exec "$@") > >(sed -u "s|^|${prefix}|") 2>&1 &
  LABELS+=("$label")
  PIDS+=("$!")
}

# Downward signal first to the process group (bun -> vite/node), then to the
# job itself in case it is already gone from the group. DOWN guards a double
# teardown: the INT/TERM handlers call down() and then exit through the EXIT trap.
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

# workspace deps are per package; install once if anything is missing
if [[ ! -d "$ROOT/node_modules" || ! -d "$ROOT/packages/web/node_modules" ]]; then
  say "installing workspace dependencies"
  (cd "$ROOT" && bun install)
fi

if [[ "$IMPORT_FIRST" == true ]]; then
  say "importing sessions"
  (cd "$ROOT" && bun run scout import)
fi

serve_args=(serve --port "$API_PORT")
if [[ -n "$DB_PATH" ]]; then
  serve_args+=(--db "$DB_PATH")
fi

if [[ "$API_PORT" != 8787 ]]; then
  say "note: packages/web/vite.config.ts proxies /api to 127.0.0.1:8787 — point it at $API_PORT too, or /api will 502"
fi

launch api "$C_API" "$ROOT" bun run scout "${serve_args[@]}"
launch web "$C_WEB" "$ROOT/packages/web" bun run dev

say "${C_API}api${NC} http://127.0.0.1:${API_PORT}  ${C_DIM}|${NC}  ${C_WEB}web${NC} http://localhost:5173  ${C_DIM}|${NC}  Ctrl-C stops both"

# bash 3.2 has no `wait -n`: poll the children, and stop everything if one exits.
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
