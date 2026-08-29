#!/usr/bin/env bash
# Shared setup for every ft-* script. Sourced, never executed.
#
# Locates the repository without git (this tree need not be a git repo), loads
# credentials from the environment or from a file outside the repo, and fixes
# the generation parameters in one place so that no run can quietly use others.

# --- repository root: walk up for a marker, never `git rev-parse` -------------
ft_root() {
  local d=${FIELDTEST_ROOT:-$PWD}
  while [ "$d" != "/" ]; do
    [ -f "$d/harness/judge-prompt.md" ] && { printf '%s\n' "$d"; return 0; }
    d=$(dirname "$d")
  done
  echo "fieldtest: repository root not found (no harness/judge-prompt.md above $PWD)" >&2
  return 1
}
FT_ROOT=$(ft_root) || exit 1
export FT_ROOT

# --- credentials: environment wins, then a file outside the repo --------------
_envfile="$HOME/.config/fieldtest/omlx.env"
# shellcheck disable=SC1090
[ -f "$_envfile" ] && . "$_envfile"
: "${OMLX_BASE:=http://localhost:9050/v1}"
: "${OMLX_MODEL:=Qwen3.8-27B-MLX-6bit}"
: "${OMLX_KEY:?OMLX_KEY is not set and $_envfile does not define it}"
# aider-style ids arrive as "openai/<id>"; the raw API wants the bare id.
OMLX_MODEL=${OMLX_MODEL#openai/}
export OMLX_BASE OMLX_MODEL OMLX_KEY

# --- fixed generation parameters ---------------------------------------------
# Changing any of these invalidates comparison with every run already recorded.
# They are documented, with the measurements behind them, in harness/README.md.
: "${FT_TEMPERATURE:=0.6}"
: "${FT_TOP_P:=0.95}"
: "${FT_TOP_K:=20}"
: "${FT_MAX_TOKENS:=16384}"      # the server's output ceiling; thinking is paid out of it
: "${FT_CONTEXT_WINDOW:=32768}"  # client-side budget; keep equal to the server's setting
: "${FT_REQUEST_TIMEOUT:=3600}"  # seconds; a request that hangs must not hang the campaign
export FT_TEMPERATURE FT_TOP_P FT_TOP_K FT_MAX_TOKENS FT_CONTEXT_WINDOW FT_REQUEST_TIMEOUT

# --- run lock -----------------------------------------------------------------
# ft-flush refuses to unload the model while this exists. Unloading mid-generation
# leaves the client waiting on a request nobody will answer: the socket stays open,
# nothing times out, and the run is lost silently.
FT_LOCK="${TMPDIR:-/tmp}/fieldtest-run.lock"
export FT_LOCK

ft_model_slug() { printf '%s\n' "$OMLX_MODEL" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9.-' '-' | sed 's/-\{2,\}/-/g; s/^-//; s/-$//'; }
