#!/bin/sh
# Prepares the repository the coding worker operates on. Done at start, never
# at build: the token is a runtime secret, and a checkout baked into a layer is
# a checkout in every registry that ever holds the image.
set -eu

wants_coder() { case ",${WORKER_QUEUES:-}," in *,coder,*) return 0 ;; *) return 1 ;; esac; }

if wants_coder; then
  : "${GITHUB_TOKEN:?coder queue enabled but GITHUB_TOKEN is unset}"
  : "${GITHUB_REPOSITORY:?coder queue enabled but GITHUB_REPOSITORY is unset}"
  if [ ! -d "${REPO_CHECKOUT_PATH}/.git" ]; then
    git clone --quiet --no-tags \
      "https://github.com/${GITHUB_REPOSITORY}.git" "${REPO_CHECKOUT_PATH}"
  else
    git -C "${REPO_CHECKOUT_PATH}" fetch --quiet --prune origin
    git -C "${REPO_CHECKOUT_PATH}" reset --quiet --hard origin/HEAD
  fi
  git -C "${REPO_CHECKOUT_PATH}" config user.name  "${GIT_AUTHOR_NAME:-product-ops-worker}"
  git -C "${REPO_CHECKOUT_PATH}" config user.email "${GIT_AUTHOR_EMAIL:-product-ops-worker@users.noreply.github.com}"
  # The checkout's own toolchain, so `pnpm typecheck|lint|test|build` inside a
  # worktree resolve. Playwright browsers are never downloaded: test:e2e is
  # not a verify step.
  ( cd "${REPO_CHECKOUT_PATH}" && pnpm install --frozen-lockfile --prefer-offline )
fi

exec "$@"
