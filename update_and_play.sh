#!/usr/bin/env bash
# update_and_play.sh - check for updates on GitHub, update only if needed, then play.
# Make it executable once: chmod +x update_and_play.sh
set -u

cd "$(dirname "$(readlink -f "$0" 2>/dev/null || echo "$0")")" || exit 1

API="https://api.github.com/repos/mindaniel/police_protest_game/commits/main"
REPO_ZIP="https://codeload.github.com/mindaniel/police_protest_game/zip/refs/heads/main"
ZIP_NAME="police_protest_game-main"

if [ ! -f index.html ]; then
    echo "ERROR: index.html not found in $(pwd)" >&2
    exit 1
fi

start_game() {
    if [ "$(uname -s 2>/dev/null || echo unknown)" = "Darwin" ]; then
        nohup open "index.html" >/dev/null 2>&1 &
    else
        nohup xdg-open "index.html" >/dev/null 2>&1 &
    fi
    exit 0
}

# --- Git clone: fetch and compare, pull only if behind ----------------------
if [ -d .git ] && command -v git >/dev/null 2>&1; then
    if [ -n "$(git status --porcelain --untracked-files=no 2>/dev/null)" ]; then
        echo "Local changes found - playing the current version"
        start_game
    fi

    if ! git fetch --quiet origin main >/dev/null 2>&1; then
        echo "Offline - playing the last version"
        start_game
    fi

    OLD_HEAD="$(git rev-parse HEAD 2>/dev/null || echo '')"
    REMOTE_HEAD="$(git rev-parse origin/main 2>/dev/null || echo '')"

    if [ -n "$REMOTE_HEAD" ] && [ "$OLD_HEAD" = "$REMOTE_HEAD" ]; then
        echo "Already up to date"
        start_game
    fi

    if ! git merge --ff-only origin/main >/dev/null 2>&1; then
        git pull --ff-only origin main >/dev/null 2>&1 || true
    fi

    NEW_HEAD="$(git rev-parse HEAD 2>/dev/null || echo '')"
    if [ -z "$NEW_HEAD" ] || [ "$NEW_HEAD" = "$OLD_HEAD" ]; then
        echo "Update failed - playing the current version"
        start_game
    fi

    SHORT="$(git rev-parse --short "$NEW_HEAD" 2>/dev/null || echo "$NEW_HEAD")"
    SUBJ="$(git log -1 --pretty=%s "$NEW_HEAD" 2>/dev/null || echo '')"
    echo "Updated to $SHORT - $SUBJ"
    start_game
fi

# --- Zip install: compare version.txt with the latest commit sha ------------
LOCAL_SHA=""
if [ -f version.txt ]; then
    LOCAL_SHA="$(tr -d '[:space:]' < version.txt 2>/dev/null)"
fi

JSON=""
if command -v curl >/dev/null 2>&1; then
    JSON="$(curl -fsSL --max-time 10 -H "User-Agent: police-protest-game-updater" "$API" 2>/dev/null)" || JSON=""
elif command -v wget >/dev/null 2>&1; then
    JSON="$(wget -qO- --timeout=10 --header="User-Agent: police-protest-game-updater" "$API" 2>/dev/null)" || JSON=""
fi

REMOTE_SHA=""
if [ -n "${JSON:-}" ]; then
    REMOTE_SHA="$(printf '%s' "$JSON" \
        | grep -o '"sha"[[:space:]]*:[[:space:]]*"[0-9a-f]\{40\}"' \
        | head -n 1 \
        | grep -o '[0-9a-f]\{40\}' \
        | head -n 1)"
fi

if [ -z "${REMOTE_SHA:-}" ]; then
    echo "Offline or version check failed - playing the last version"
    start_game
fi

if [ -n "$LOCAL_SHA" ] && [ "$LOCAL_SHA" = "$REMOTE_SHA" ]; then
    echo "Already up to date"
    start_game
fi

echo "Update available - downloading..."
TMPD="$(mktemp -d 2>/dev/null)" || TMPD=""
if [ -z "$TMPD" ]; then
    echo "Update failed - playing the last version"
    start_game
fi
trap 'rm -rf "$TMPD"' EXIT

ZIPFILE="$TMPD/game.zip"
OK=0
if command -v curl >/dev/null 2>&1; then
    curl -fsSL --max-time 120 "$REPO_ZIP" -o "$ZIPFILE" >/dev/null 2>&1 && OK=1
elif command -v wget >/dev/null 2>&1; then
    wget -q --timeout=120 "$REPO_ZIP" -O "$ZIPFILE" >/dev/null 2>&1 && OK=1
fi
if [ "$OK" -ne 1 ] || [ ! -s "$ZIPFILE" ]; then
    echo "Download failed - playing the last version"
    start_game
fi

EXDIR="$TMPD/x"
mkdir -p "$EXDIR"
UNZIP_OK=0
if command -v unzip >/dev/null 2>&1; then
    unzip -q "$ZIPFILE" -d "$EXDIR" >/dev/null 2>&1 && UNZIP_OK=1
elif command -v python3 >/dev/null 2>&1; then
    python3 -m zipfile -e "$ZIPFILE" "$EXDIR" >/dev/null 2>&1 && UNZIP_OK=1
elif command -v tar >/dev/null 2>&1; then
    tar -xf "$ZIPFILE" -C "$EXDIR" >/dev/null 2>&1 && UNZIP_OK=1
fi
if [ "$UNZIP_OK" -ne 1 ] || [ ! -f "$EXDIR/$ZIP_NAME/index.html" ]; then
    echo "Update failed - playing the last version"
    start_game
fi

cp -R "$EXDIR/$ZIP_NAME/." . 2>/dev/null
printf '%s\n' "$REMOTE_SHA" > version.txt 2>/dev/null || true
echo "Updated to ${REMOTE_SHA:0:7} - playing the newest version"
start_game
