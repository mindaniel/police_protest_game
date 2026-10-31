#!/usr/bin/env bash
# update_and_play.sh - update the game from GitHub and open it in the browser.
# Double-click this file (make it executable first: chmod +x update_and_play.sh).
set -u

# Move to the folder this script lives in.
cd "$(dirname "$(readlink -f "$0" 2>/dev/null || echo "$0")")" || exit 0

REPO_URL="https://codeload.github.com/mindaniel/police_protest_game/zip/refs/heads/main"
ZIP_NAME="police_protest_game-main"
STATUS=""
NOTIFY=""

# Determine platform for opening later.
OS="$(uname -s 2>/dev/null || echo unknown)"

# Helper: desktop notification if available (Linux), silent otherwise.
notify() {
    NOTIFY="$1"
    if command -v notify-send >/dev/null 2>&1; then
        notify-send "Police vs Protestors" "$1" >/dev/null 2>&1 || true
    fi
    echo "$1"
}

# Sanity check: the game must exist.
if [ ! -f index.html ]; then
    echo "ERROR: index.html not found in $(pwd)" >&2
    exit 1
fi

UPDATED=0
UP_TO_DATE=0
OFFLINE=0

if [ -d .git ] && command -v git >/dev/null 2>&1; then
    # Git checkout: update only when there are no local changes to tracked files.
    if [ -n "$(git status --porcelain --untracked-files=no 2>/dev/null)" ]; then
        STATUS="Local changes found - skipping update, playing current version"
        notify "$STATUS"
    else
        OLD_HEAD="$(git rev-parse HEAD 2>/dev/null || echo '')"
        if git fetch --quiet origin main >/dev/null 2>&1; then
            # Try fast-forward merge; fall back to pull --ff-only.
            if ! git merge --ff-only origin/main >/dev/null 2>&1; then
                git pull --ff-only >/dev/null 2>&1 || true
            fi
            NEW_HEAD="$(git rev-parse HEAD 2>/dev/null || echo '')"
            if [ -n "$NEW_HEAD" ] && [ "$NEW_HEAD" != "$OLD_HEAD" ]; then
                SHORT="$(git rev-parse --short "$NEW_HEAD" 2>/dev/null || echo "$NEW_HEAD")"
                SUBJ="$(git log -1 --pretty=%s "$NEW_HEAD" 2>/dev/null || echo '')"
                STATUS="Updated to $SHORT - $SUBJ"
                notify "$STATUS"
                UPDATED=1
            else
                STATUS="Already up to date"
                notify "$STATUS"
                UP_TO_DATE=1
            fi
        else
            STATUS="Offline - playing the last version"
            notify "$STATUS"
            OFFLINE=1
        fi
    fi
else
    # Not a git checkout (or no git): download the zip and overlay its files.
    TMPDIR="$(mktemp -d 2>/dev/null || echo '')"
    if [ -n "$TMPDIR" ]; then
        trap 'rm -rf "$TMPDIR"' EXIT
    fi

    DOWNLOAD_OK=0
    if [ -n "$TMPDIR" ]; then
        ZIPFILE="$TMPDIR/game.zip"
        if command -v curl >/dev/null 2>&1; then
            curl -fsSL "$REPO_URL" -o "$ZIPFILE" >/dev/null 2>&1 && DOWNLOAD_OK=1
        elif command -v wget >/dev/null 2>&1; then
            wget -q "$REPO_URL" -O "$ZIPFILE" >/dev/null 2>&1 && DOWNLOAD_OK=1
        fi

        if [ "$DOWNLOAD_OK" -eq 1 ] && [ -s "$ZIPFILE" ]; then
            EXTRACT_DIR="$TMPDIR/extract"
            mkdir -p "$EXTRACT_DIR"
            UNZIP_OK=0
            if command -v unzip >/dev/null 2>&1; then
                unzip -q "$ZIPFILE" -d "$EXTRACT_DIR" >/dev/null 2>&1 && UNZIP_OK=1
            elif command -v python3 >/dev/null 2>&1; then
                python3 -m zipfile -e "$ZIPFILE" "$EXTRACT_DIR" >/dev/null 2>&1 && UNZIP_OK=1
            fi

            if [ "$UNZIP_OK" -eq 1 ] && [ -d "$EXTRACT_DIR/$ZIP_NAME" ]; then
                # Copy new files over the game folder. Never delete anything.
                cp -R "$EXTRACT_DIR/$ZIP_NAME/." . 2>/dev/null
                date '+%Y-%m-%d %H:%M:%S' > .last_update 2>/dev/null || true
                STATUS="Updated (zip) - playing the newest version"
                notify "$STATUS"
                UPDATED=1
            else
                STATUS="Download failed - playing the last version"
                notify "$STATUS"
                OFFLINE=1
            fi
        else
            STATUS="Offline - playing the last version"
            notify "$STATUS"
            OFFLINE=1
        fi
    else
        STATUS="Offline - playing the last version"
        notify "$STATUS"
        OFFLINE=1
    fi
fi

# Open the game in the default browser, detached.
if [ "$OS" = "Darwin" ]; then
    nohup open "index.html" >/dev/null 2>&1 &
else
    nohup xdg-open "index.html" >/dev/null 2>&1 &
fi

exit 0
