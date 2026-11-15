#!/usr/bin/env bash
# install.sh - expose the Mure skill to the harnesses installed on this machine.
#
# Creates a symbolic link from each skills directory to this repository.
# Idempotent: an existing link pointing here is left alone, a real directory is
# reported and skipped.
#
#   ./install.sh            link into every known skills directory that exists
#   ./install.sh --copy     copy instead of link
#   ./install.sh DIR...     link only into these skills directories

set -euo pipefail

src="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ ! -f "$src/SKILL.md" ]; then
  echo "SKILL.md not found next to install.sh ($src)" >&2
  exit 1
fi
command -v node >/dev/null 2>&1 || echo "warning: node not found on PATH; scripts/mure.mjs will not run" >&2

copy=0
targets=()
for arg in "$@"; do
  case "$arg" in
    --copy) copy=1 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) targets+=("$arg") ;;
  esac
done

# Declared empty array: `${#targets[@]}` is safe under `set -u` in bash 3.2.
if [ "${#targets[@]}" -eq 0 ]; then
  targets=(
    "$HOME/.config/opencode/skills"
    "$HOME/.claude/skills"
    "$HOME/.agents/skills"
  )
fi

linked=0
skipped=0

# Resolve a path physically (macOS readlink has no -f).
resolve() { (cd "$1" 2>/dev/null && pwd -P) || true; }
src_real="$(resolve "$src")"

for dir in "${targets[@]}"; do
  parent="$(dirname "$dir")"
  if [ ! -d "$parent" ]; then
    echo "skip  $dir (no $parent)"
    skipped=$((skipped + 1))
    continue
  fi
  mkdir -p "$dir"
  dest="$dir/mure"
  if [ -e "$dest" ] || [ -L "$dest" ]; then
    if [ -L "$dest" ] && [ "$(resolve "$dest")" = "$src_real" ]; then
      echo "ok    $dest (already linked)"
      linked=$((linked + 1))
      continue
    fi
    echo "skip  $dest (exists; remove it to reinstall)"
    skipped=$((skipped + 1))
    continue
  fi
  if [ "$copy" -eq 1 ]; then
    dir_real="$(resolve "$dir")"
    case "$dir_real/" in
      "$src_real"/*)
        echo "skip  $dir (inside the source repository; choose a directory outside it)"
        skipped=$((skipped + 1))
        continue ;;
    esac
    cp -R "$src" "$dest"
    rm -rf "$dest/.git"
    echo "copy  $dest"
  else
    ln -s "$src" "$dest"
    echo "link  $dest -> $src"
  fi
  linked=$((linked + 1))
done

echo
echo "linked/installed: $linked   skipped: $skipped"
echo "Restart your harness so it re-reads its skills directory."
