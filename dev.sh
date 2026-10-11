#!/usr/bin/env bash
#
# Vencord userplugin dev loop.
#
# Plugin sources live in ./plugins and are *copied* into Vencord's
# src/userplugins on each sync. A symlink would be nicer, but esbuild resolves
# symlinks to their real path, which lands outside Vencord's tsconfig root and
# breaks the "@utils/*" path aliases. src/userplugins is gitignored, so the
# copies stay out of git.
#
#   ./dev.sh sync      copy plugins/*.tsx? into $VENCORD_DIR/src/userplugins
#   ./dev.sh build     rebuild Vencord (esbuild, ~15s)
#   ./dev.sh reload    reload the renderer over CDP (~15s) — this is what picks
#                      up a new build; needs OPEN_ARGS=--remote-debugging-port
#   ./dev.sh restart   quit + relaunch Discord, capturing stdout/stderr to $LOG
#   ./dev.sh logs [re] show Vencord + plugin lines from the captured log
#   ./dev.sh cycle [re] sync + build + reload + logs  (full verification loop)
#
# Note: a rebuilt bundle needs a real document reload. Discord's login -> app
# transition is client-side, so it will NOT pick up a new build by itself.
#
# Env overrides: VENCORD_DIR, DISCORD_APP, LOG, OPEN_ARGS
# OPEN_ARGS is passed to the app, e.g. OPEN_ARGS="--remote-debugging-port=9222"
# to enable tools/cdp.mjs. Leave empty for a normal launch.
# NOTE: Discord forwards renderer console output to the main process stdout, so
# anything your plugin logs (Logger or console.*) lands in $LOG.

set -euo pipefail

WORKSPACE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENCORD_DIR="${VENCORD_DIR:-$HOME/Vencord}"
DISCORD_APP="${DISCORD_APP:-Discord Canary}"
LOG="${LOG:-/tmp/canary.log}"
OPEN_ARGS="${OPEN_ARGS:-}"
USERPLUGINS="$VENCORD_DIR/src/userplugins"
MANIFEST="$WORKSPACE/.deployed"
MAIN_BIN="/Applications/$DISCORD_APP.app/Contents/MacOS/$DISCORD_APP"

die() { echo "error: $*" >&2; exit 1; }

sync() {
    [ -d "$USERPLUGINS" ] || die "missing $USERPLUGINS"

    # clean up leftovers from an older symlink-based setup, and any plugin we
    # deployed before but that no longer exists here
    local f name
    for f in "$USERPLUGINS"/*; do
        [ -L "$f" ] || continue
        case "$(readlink "$f")" in
            "$WORKSPACE"/*) rm "$f"; echo "removed stale symlink $(basename "$f")" ;;
        esac
    done
    if [ -f "$MANIFEST" ]; then
        while read -r name; do
            [ -n "$name" ] || continue
            [ -f "$WORKSPACE/plugins/$name" ] || { rm -f "$USERPLUGINS/$name"; echo "undeployed $name"; }
        done < "$MANIFEST"
    fi

    : > "$MANIFEST"
    shopt -s nullglob
    local src
    for src in "$WORKSPACE"/plugins/*.ts "$WORKSPACE"/plugins/*.tsx; do
        name="$(basename "$src")"
        cp "$src" "$USERPLUGINS/$name"
        echo "$name" >> "$MANIFEST"
        echo "deployed $name"
    done
}

build() {
    echo "building $VENCORD_DIR ..."
    (cd "$VENCORD_DIR" && pnpm build) | tail -5
}

restart() {
    local main
    main="$(pgrep -f "^$MAIN_BIN$" | head -1 || true)"
    if [ -n "$main" ]; then
        echo "quitting $DISCORD_APP (pid $main)"
        kill "$main" 2>/dev/null || true
        for _ in $(seq 1 30); do
            pgrep -f "/Applications/$DISCORD_APP.app" >/dev/null 2>&1 || break
            sleep 0.5
        done
        pgrep -f "/Applications/$DISCORD_APP.app" >/dev/null 2>&1 &&
            die "$DISCORD_APP did not exit; refusing to launch a second instance"
    fi
    rm -f "$LOG"
    # shellcheck disable=SC2086
    open -a "$DISCORD_APP" --stdout "$LOG" --stderr "$LOG" ${OPEN_ARGS:+--args $OPEN_ARGS} \
        || die "could not launch $DISCORD_APP"
    for _ in $(seq 1 60); do
        grep -q "\[Vencord\] Starting up" "$LOG" 2>/dev/null && break
        sleep 1
    done
    grep -q "\[Vencord\] Starting up" "$LOG" 2>/dev/null ||
        die "$DISCORD_APP launched but Vencord never logged startup — check $LOG"
    echo "relaunched; waiting for plugins to settle"
    sleep 12
}

logs() {
    local pattern="${1:-.}"
    [ -f "$LOG" ] || die "no log at $LOG"
    grep -iE "vencord|$pattern" "$LOG" | tail -60
}

# Reload the renderer in-place over CDP. Re-running the preload re-injects
# dist/renderer.js, which is how an edited plugin actually goes live.
reloadRenderer() {
    local port="${CDP_PORT:-9222}"
    curl -sf --max-time 3 "http://127.0.0.1:$port/json/version" >/dev/null \
        || die "no CDP endpoint on 127.0.0.1:$port — start Discord with OPEN_ARGS=\"--remote-debugging-port=$port\""
    node "$WORKSPACE/tools/cdp.mjs" 'location.reload(), "reloading"' >/dev/null 2>&1 \
        || die "could not reload the renderer over CDP"
    echo "renderer reloaded; waiting for the app to come back"
    sleep 15
}

cycle() { sync; build; reloadRenderer; logs "${1:-.}"; }

case "${1:-}" in
    sync)    sync ;;
    build)   build ;;
    restart) restart ;;
    logs)    logs "${2:-.}" ;;
    cycle)   cycle "${2:-.}" ;;
    reload)  reloadRenderer; logs "${2:-.}" ;;
    *)
        sed -n '3,23p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
        exit 1
        ;;
esac
