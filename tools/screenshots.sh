#!/usr/bin/env bash
#
# Regenerate the README screenshots from the recreations in assets/mockups.
#
# Each shot is a plain HTML page rendered in headless Chrome at 2x, so the PNGs
# are crisp without anyone having to capture their own Discord window — which is
# the point: the pictures contain generated handles, ids and avatars, never a
# real account, server or message.
#
#   tools/screenshots.sh              render every shot into assets/screenshots
#   SCALE=1 tools/screenshots.sh      smaller files, less detail
#   CHROME=/path/to/chrome tools/...  use a different browser binary
#
# The mockups are static: open assets/mockups/*.html in a browser to look at one,
# no build step and no dependencies.

set -euo pipefail

WORKSPACE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOCKUPS="$WORKSPACE/assets/mockups"
OUT="$WORKSPACE/assets/screenshots"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
SCALE="${SCALE:-2}"

[ -x "$CHROME" ] || {
    echo "error: no browser at '$CHROME' — set CHROME=/path/to/chrome" >&2
    exit 1
}

mkdir -p "$OUT"

# page:width:height — the window each mockup is drawn for. The page sizes itself
# to the window, so these numbers are the shot's composition, not a crop.
SHOTS=(
    "overview:1080:680"
    "member-list:340:262"
    "button-states:600:220"
    "context-menu:620:340"
    "settings:940:980"
)

# A throwaway profile keeps this from talking to an already-running Chrome.
PROFILE="$(mktemp -d)"
trap 'rm -rf "$PROFILE"' EXIT

LIMIT="${LIMIT:-60}"   # seconds to allow a single render before giving up

# Watchdog rather than a bare call: a headless browser that never exits would
# otherwise hang the whole run, and macOS has no `timeout` to fall back on.
render() {
    local page="$1" width="$2" height="$3" target="$4" pid waited=0

    "$CHROME" \
        --headless=new \
        --disable-gpu \
        --hide-scrollbars \
        --no-first-run \
        --no-default-browser-check \
        --user-data-dir="$PROFILE" \
        --force-device-scale-factor="$SCALE" \
        --window-size="$width,$height" \
        --screenshot="$target" \
        "file://$MOCKUPS/$page.html" >/dev/null 2>&1 &
    pid=$!

    while kill -0 "$pid" 2>/dev/null; do
        if [ "$waited" -ge "$LIMIT" ]; then
            kill "$pid" 2>/dev/null || true
            echo "error: rendering $page took longer than ${LIMIT}s — killed" >&2
            return 1
        fi
        sleep 1
        waited=$((waited + 1))
    done

    wait "$pid" 2>/dev/null || true
}

for shot in "${SHOTS[@]}"; do
    IFS=: read -r page width height <<< "$shot"
    target="$OUT/$page.png"
    rm -f "$target"

    render "$page" "$width" "$height" "$target" || exit 1

    [ -s "$target" ] || {
        echo "error: $page.png was not written" >&2
        exit 1
    }

    size="$(sips -g pixelWidth -g pixelHeight "$target" 2>/dev/null |
        awk '/pixelWidth|pixelHeight/ { printf "%s%s", sep, $2; sep = "x" }')"
    printf '%-18s %-12s %s\n' "$page.png" "$size" "$(du -h "$target" | cut -f1)"
done

echo "wrote $(ls -1 "$OUT" | wc -l | tr -d ' ') screenshots to $OUT"
