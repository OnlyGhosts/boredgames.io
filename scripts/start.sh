#!/bin/sh
# The container's command (Dockerfile): runs the server as the node user. Started as root, as on
# Fly, it first gives the analytics volume (the directory of ANALYTICS_DB, which Fly mounts owned
# by root) to node; started as anyone else it just runs the command.
set -e
if [ "$(id -u)" = "0" ]; then
  if [ -n "$ANALYTICS_DB" ]; then
    dir=$(dirname "$ANALYTICS_DB")
    # Never in the way of the games: without the volume the server counts in memory instead.
    mkdir -p "$dir" && chown -R node:node "$dir" || echo "start.sh: could not hand $dir to the node user" >&2
  fi
  if command -v su-exec > /dev/null; then exec su-exec node "$@"; fi
  echo "start.sh: su-exec is missing, running as root" >&2
fi
exec "$@"
