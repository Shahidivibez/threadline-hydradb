#!/bin/sh
set -eu

: "${GRAPH_AUTH_TOKEN:?Set GRAPH_AUTH_TOKEN in the hosting dashboard}"
export GRAPH_AUTH_TOKEN_FILE="${GRAPH_AUTH_TOKEN_FILE:-/tmp/hydradb-auth-token}"
export LOCAL_PATH="${LOCAL_PATH:-/tmp/hydradb/store}"
export GRAPH_DATA_CACHE_DIR="${GRAPH_DATA_CACHE_DIR:-/tmp/hydradb/cache}"

mkdir -p "$LOCAL_PATH" "$GRAPH_DATA_CACHE_DIR"
umask 077
printf '%s' "$GRAPH_AUTH_TOKEN" > "$GRAPH_AUTH_TOKEN_FILE"
exec /usr/local/bin/graph-node
