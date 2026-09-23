#!/bin/sh
# git calls this for credentials. The token is printed from the environment
# and appears nowhere else: not in a URL, not in .git/config, not in argv.
case "$1" in
  Username*) printf '%s\n' "x-access-token" ;;
  Password*) printf '%s\n' "${GITHUB_TOKEN}" ;;
esac
