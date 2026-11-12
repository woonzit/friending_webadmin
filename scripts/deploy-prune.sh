#!/usr/bin/env bash

# The removal half of a release.
#
# `deploy.sh` uploads with rsync and never passes `--delete`, because the server owns files a
# workstation must not touch (`.env.local`, the build cache, `.deploy_commit`). On its own that
# leaves every tracked file a commit removed on the server for good: still compiled, still served
# when it is a route, still run when it is a test. This script removes exactly those files and
# nothing else.
#
#   deploy-prune.sh list <repository> <live-commit> <new-commit>
#       Prints the tracked paths of <live-commit> that <new-commit> no longer has, one per line.
#       It reads Git objects only, so it works for a release and for a rollback alike.
#
#   deploy-prune.sh apply <directory> [--dry-run]        (paths on standard input, one per line)
#       Removes those files below <directory>, then the directories the removal left empty.
#       A listed file that is already gone is skipped, so a repeated run is harmless.
#
# `apply` trusts nothing about its input. Every path is checked before the first file is removed,
# and one refused path stops the run with nothing removed: an absolute path, one that climbs out
# of the directory or reaches it through a link, one that names a server-owned or generated file,
# or one that is neither a regular file nor a link.
#
# Written for bash 3.2 (the workstation) and bash 5 (the server).

set -euo pipefail

usage() {
  echo "Usage: deploy-prune.sh list <repository> <live-commit> <new-commit>" >&2
  echo "       deploy-prune.sh apply <directory> [--dry-run] < paths" >&2
  exit 2
}

# Server-owned and generated names: what deploy.sh's rsync excludes, at any depth.
protected_component() {
  case "$1" in
    .env | .env.local | .env.*.local | .deploy_commit | node_modules | .next | .git) return 0 ;;
    *.tsbuildinfo | *.log) return 0 ;;
  esac
  return 1
}

list_removed() {
  local repository="$1" live="$2" new="$3" commit
  for commit in "$live" "$new"; do
    if ! git -C "$repository" cat-file -e "$commit^{commit}" 2>/dev/null; then
      echo "deploy-prune: not a commit in this repository: $commit" >&2
      exit 3
    fi
  done
  local scratch
  scratch="$(mktemp -d)"
  git -C "$repository" -c core.quotePath=false ls-tree -r --name-only "$live" | LC_ALL=C sort >"$scratch/live"
  git -C "$repository" -c core.quotePath=false ls-tree -r --name-only "$new" | LC_ALL=C sort >"$scratch/new"
  LC_ALL=C comm -23 "$scratch/live" "$scratch/new"
  rm -f -- "$scratch/live" "$scratch/new"
  rmdir -- "$scratch"
}

refuse() {
  echo "deploy-prune: refused, nothing was removed: $1" >&2
  exit 4
}

# Exits through `refuse` unless `$1` is a path this script may remove below the current directory.
check_path() {
  local path="$1" root="$2" rest component parent
  case "$path" in
    /*) refuse "absolute path: $path" ;;
    */) refuse "directory path: $path" ;;
  esac
  rest="$path"
  while [[ -n "$rest" ]]; do
    component="${rest%%/*}"
    if [[ "$rest" == */* ]]; then rest="${rest#*/}"; else rest=""; fi
    case "$component" in
      "" | . | ..) refuse "path is not a plain relative path: $path" ;;
    esac
    if protected_component "$component"; then
      refuse "server-owned or generated path: $path"
    fi
  done
  parent="$(dirname -- "$path")"
  # A parent that is gone means the file is gone too; `apply` skips it.
  if [[ -d "$parent" ]]; then
    parent="$(cd -- "$parent" && pwd -P)"
    if [[ "$parent" != "$root" && "$parent" != "$root"/* ]]; then
      refuse "path leaves the directory through a link: $path"
    fi
    if [[ -e "$path" && ! -L "$path" && ! -f "$path" ]]; then
      refuse "not a regular file: $path"
    fi
  fi
}

apply_removed() {
  local directory="$1" dry_run="$2" root path parent count=0
  if [[ ! -d "$directory" ]]; then
    echo "deploy-prune: not a directory: $directory" >&2
    exit 2
  fi
  cd -- "$directory"
  root="$(pwd -P)"

  local paths=()
  while IFS= read -r path || [[ -n "$path" ]]; do
    [[ -z "$path" ]] && continue
    check_path "$path" "$root"
    paths+=("$path")
  done

  for path in ${paths[@]+"${paths[@]}"}; do
    if [[ ! -L "$path" && ! -f "$path" ]]; then
      continue
    fi
    count=$((count + 1))
    if [[ "$dry_run" == "yes" ]]; then
      echo "would remove $path"
      continue
    fi
    rm -f -- "$path"
    echo "removed $path"
    # Only the directories this removal emptied: rmdir refuses one that still holds anything.
    parent="$(dirname -- "$path")"
    while [[ "$parent" != "." ]] && rmdir -- "$parent" 2>/dev/null; do
      parent="$(dirname -- "$parent")"
    done
  done

  if [[ "$dry_run" == "yes" ]]; then
    echo "deploy-prune: $count file(s) would be removed."
  else
    echo "deploy-prune: $count file(s) removed."
  fi
}

case "${1:-}" in
  list)
    [[ $# -eq 4 ]] || usage
    list_removed "$2" "$3" "$4"
    ;;
  apply)
    [[ $# -eq 2 || ($# -eq 3 && "$3" == "--dry-run") ]] || usage
    if [[ $# -eq 3 ]]; then apply_removed "$2" yes; else apply_removed "$2" no; fi
    ;;
  *)
    usage
    ;;
esac
