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
    # One model id is many endpoints and they are not the same model:
    # qwen/qwen3.8-27b has fourteen, nine fp8, four unknown and one fp4, with
    # output ceilings from 32,768 to 235,929. Pinned so a campaign measures one
    # model instead of sampling across quantizations. See FINDINGS 4.19.
    : "${FT_PROVIDERS:=Parasail,Novita,Mancer 2}"
    export FT_HTTP_REFERER FT_APP_TITLE FT_PROVIDERS
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

# --- generation parameters, in three layers -----------------------------------
#
# 1. THE MODEL'S OWN RECOMMENDATION. Travels with the model, not with the machine,
#    so it holds wherever the model runs. It is *not* a harness constant: pointing
#    FT_MODEL at something else means reading that model's card.
#
#    These are Qwen3.8's card values for thinking mode, which is its default mode.
#    An earlier campaign ran at 0.6 — Qwen3 guidance carried over to a different
#    model — and every run taken that way was discarded rather than compared.
: "${FT_TEMPERATURE:=1.0}"
: "${FT_TOP_P:=0.95}"
: "${FT_TOP_K:=20}"
export FT_TEMPERATURE FT_TOP_P FT_TOP_K

: "${FT_REQUEST_TIMEOUT:=3600}"  # seconds; a hung request must not hang a campaign
export FT_REQUEST_TIMEOUT

# 2. WHAT THIS MACHINE IMPOSES. Every value below exists because a 27B model runs on
#    a 48 GB laptop through one oMLX server. None of it is a fact about the model,
#    and none of it is applied to a provider that does not share the constraint —
#    a field test measures what a developer would do, and nobody imposes a laptop's
#    output ceiling on an API.
if [ "$FT_PROVIDER" = omlx ]; then
  # The server's own output ceiling. Reasoning is paid out of it, which is what
  # forced the phase design in FINDINGS 3.1: no single reply can hold a problem.
  : "${FT_MAX_TOKENS:=16384}"
  # Measured, not inherited: prefill is linear at ~120 tok/s (FINDINGS 2.6), so a
  # full window costs four and a half minutes before the first token. Nothing here
  # sends more than a few thousand.
  : "${FT_CONTEXT_WINDOW:=32768}"
  # A consequence of the ceiling above, not a preference. At the model's own default
  # the plan phase overflowed in 3 of 3 runs and the harness fell back to `low`, so
  # every run was governed by a low-effort plan. At `medium`, 6 of 6 replayed phases
  # fit. See FINDINGS 6.2. Remove the ceiling and this reason disappears with it.
  : "${FT_REASONING_EFFORT:=medium}"
else
  # 3. HOSTED. The limits above do not exist here, so they are not invented. Left
  #    unset, each falls to the provider's own default — which is what a developer
  #    calling the API gets, and therefore what a field test should measure.
  #
  #    FT_MAX_TOKENS unset  -> the model's own maximum
  #    FT_CONTEXT_WINDOW    -> a client-side guard only; generous, never binding
  #    FT_REASONING_EFFORT  -> the model's default dial, untouched
  #
  #    Set any of them explicitly to run a deliberate comparison against the local
  #    configuration; that is a diagnostic, not the default.
  : "${FT_CONTEXT_WINDOW:=1000000}"
fi
[ -n "${FT_MAX_TOKENS:-}" ] && export FT_MAX_TOKENS
[ -n "${FT_REASONING_EFFORT:-}" ] && export FT_REASONING_EFFORT
export FT_CONTEXT_WINDOW

# --- run lock -----------------------------------------------------------------
# ft-flush refuses to unload the model while this exists. Unloading mid-generation
# leaves the client waiting on a request nobody will answer: the socket stays open,
# nothing times out, and the run is lost silently.
FT_LOCK="${TMPDIR:-/tmp}/fieldtest-run.lock"
export FT_LOCK

ft_model_slug() { printf '%s\n' "$OMLX_MODEL" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9.-' '-' | sed 's/-\{2,\}/-/g; s/^-//; s/-$//'; }
