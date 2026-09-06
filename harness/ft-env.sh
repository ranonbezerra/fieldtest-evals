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

# --- provider: a local server, or a hosted one --------------------------------
# `omlx` is a model on this machine and the memory guards apply to it. `openrouter`
# is a model somewhere else: nothing here can page it out, `ft-flush` has nothing to
# flush, and the resource that runs out is money rather than RAM.
: "${FT_PROVIDER:=omlx}"
export FT_PROVIDER

# --- credentials: environment wins, then a file outside the repo --------------
# Each provider reads only its own file. Sourcing both would let the local server's
# base URL and model name survive into a hosted run through `:=`, which does not
# overwrite — and the run would quietly point at localhost with the wrong model id.
case "$FT_PROVIDER" in
  omlx)
    _envfile="$HOME/.config/fieldtest/omlx.env"
    # shellcheck disable=SC1090
    [ -f "$_envfile" ] && . "$_envfile"
    : "${OMLX_BASE:=http://localhost:9050/v1}"
    : "${OMLX_MODEL:=Qwen3.8-27B-MLX-6bit}"
    : "${OMLX_KEY:?OMLX_KEY is not set and $_envfile does not define it}"
    ;;
  openrouter)
    _envfile="$HOME/.config/fieldtest/openrouter.env"
    # shellcheck disable=SC1090
    [ -f "$_envfile" ] && . "$_envfile"
    # FT_MODEL is the knob a caller sets per run; OMLX_MODEL stays the internal name
    # so every downstream script keeps working unchanged.
    [ -n "${FT_MODEL:-}" ] && OMLX_MODEL="$FT_MODEL"
    : "${OPENROUTER_KEY:?OPENROUTER_KEY is not set and $_envfile does not define it}"
    OMLX_BASE="${OPENROUTER_BASE:-https://openrouter.ai/api/v1}"
    : "${OMLX_MODEL:?set FT_MODEL to a model id, e.g. anthropic/claude-sonnet-4.6}"
    OMLX_KEY="$OPENROUTER_KEY"
    # OpenRouter asks callers to identify themselves; it costs nothing and shows up
    # in the account's activity, which is useful when several campaigns share a key.
    : "${FT_HTTP_REFERER:=https://github.com/ranonbezerra/fieldtest-evals}"
    : "${FT_APP_TITLE:=fieldtest-evals}"
    export FT_HTTP_REFERER FT_APP_TITLE
    ;;
  *)
    echo "fieldtest: FT_PROVIDER must be omlx or openrouter, not '$FT_PROVIDER'" >&2
    exit 1
    ;;
esac

# aider-style ids arrive as "openai/<id>"; the raw API wants the bare id. Only for
# the local server — an OpenRouter id is `org/model` and the prefix is meaningful.
[ "$FT_PROVIDER" = omlx ] && OMLX_MODEL=${OMLX_MODEL#openai/}
export OMLX_BASE OMLX_MODEL OMLX_KEY

# --- fixed generation parameters ---------------------------------------------
# The model card's own recommendation for thinking mode, which is this model's
# default mode. An earlier campaign ran at 0.6 — carried over from Qwen3 guidance
# for a different model — and every run taken that way was discarded rather than
# compared against these.
#
# Changing any of these invalidates comparison with every run already recorded.
: "${FT_TEMPERATURE:=1.0}"
: "${FT_TOP_P:=0.95}"
: "${FT_TOP_K:=20}"
# xhigh | medium | low. The model's own dial for how much it deliberates before
# answering. Set to `medium`, measured rather than chosen: at the model's own default
# the plan phase overflowed the 16,384-token ceiling in 3 of 3 runs and never produced
# a specification, so the harness fell back to `low` and every run was governed by a
# low-effort plan. At `medium`, 6 of 6 replayed phases fit — the largest using 65% of
# the ceiling — and the plans stopped contradicting themselves. See FINDINGS 6.2.
# The harness still lowers to `low` as a fallback after a phase overflows.
: "${FT_REASONING_EFFORT:=medium}"
: "${FT_MAX_TOKENS:=16384}"      # the server's output ceiling; thinking is paid out of it
: "${FT_CONTEXT_WINDOW:=32768}"  # client-side budget; keep equal to the server's setting
: "${FT_REQUEST_TIMEOUT:=3600}"  # seconds; a request that hangs must not hang the campaign
export FT_TEMPERATURE FT_TOP_P FT_TOP_K FT_MAX_TOKENS FT_CONTEXT_WINDOW FT_REQUEST_TIMEOUT
export FT_REASONING_EFFORT

# --- run lock -----------------------------------------------------------------
# ft-flush refuses to unload the model while this exists. Unloading mid-generation
# leaves the client waiting on a request nobody will answer: the socket stays open,
# nothing times out, and the run is lost silently.
FT_LOCK="${TMPDIR:-/tmp}/fieldtest-run.lock"
export FT_LOCK

ft_model_slug() { printf '%s\n' "$OMLX_MODEL" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9.-' '-' | sed 's/-\{2,\}/-/g; s/^-//; s/-$//'; }
