#!/usr/bin/env bash
# Collect everything needed to write a commit message, in one pass.
# Prints: staged/unstaged summary, per-file stat, full diffs, and untracked file
# contents. Read-only: never stages, stashes, or commits anything.
set -uo pipefail

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "not a git repository" >&2
  exit 1
fi

section() { printf '\n===== %s =====\n' "$1"; }

section "STATUS"
git status --short --untracked-files=all

section "BRANCH"
git rev-parse --abbrev-ref HEAD

section "RECENT COMMITS (for message style)"
git log --oneline -10 2>/dev/null || echo "(no commits yet)"

if git diff --cached --quiet; then
  staged=no
else
  staged=yes
fi

section "SCOPE"
if [ "$staged" = yes ]; then
  echo "Changes are staged -> describe ONLY the staged set below."
  if ! git diff --quiet; then
    echo "Note: unstaged modifications also exist and are excluded from the commit."
  fi
  if [ -n "$(git ls-files --others --exclude-standard)" ]; then
    echo "Note: untracked files also exist and are excluded from the commit."
  fi
else
  echo "Nothing staged -> describe the whole working tree, untracked files included."
fi

if [ "$staged" = yes ]; then
  section "STAGED STAT"
  git diff --cached --stat
  section "STAGED DIFF"
  git diff --cached
else
  section "UNSTAGED STAT"
  git diff --stat
  section "UNSTAGED DIFF"
  git diff

  section "UNTRACKED FILES"
  untracked=$(git ls-files --others --exclude-standard)
  if [ -z "$untracked" ]; then
    echo "(none)"
  else
    printf '%s\n' "$untracked"
    printf '%s\n' "$untracked" | while IFS= read -r f; do
      printf '\n----- new file: %s -----\n' "$f"
      # --no-index exits 1 whenever the files differ, which is always here, so
      # judge success by whether it produced output rather than by status.
      out=$(git diff --no-index --no-color -- /dev/null "$f" 2>/dev/null)
      if [ -n "$out" ]; then
        printf '%s\n' "$out"
      else
        cat -- "$f" 2>/dev/null || echo "(unreadable)"
      fi
    done
  fi
fi
