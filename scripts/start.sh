#!/bin/sh
# The container's command (Dockerfile): runs the server as the node user. Started as root, as on
# Fly, it first gives the analytics volume (the directory of ANALYTICS_DB, which Fly mounts owned
# by root) to node; started as anyone else it just runs the command.
set -e
if [ "$(id -u)" = "0" ]; then
  if [ -n "$ANALYTICS_DB" ]; then
    dir=$(dirname "$ANALYTICS_DB")
    mkdir -p "$dir"
    chown -R node:node "$dir"
  fi
  exec su-exec node "$@"
fi
exec "$@"
