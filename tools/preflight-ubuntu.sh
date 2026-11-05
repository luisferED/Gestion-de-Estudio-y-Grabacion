#!/bin/sh
set -eu
port="${APP_PUBLISHED_PORT:-6680}"
case "$port" in *[!0-9]*|"") echo "Invalid port" >&2; exit 2;; esac
if [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then echo "Invalid port" >&2; exit 2; fi
command -v docker >/dev/null
command -v ss >/dev/null
docker compose version
docker network inspect dokploy-network >/dev/null
if [ -n "$(ss -H -ltn "sport = :$port")" ]; then echo "Port $port is occupied" >&2; exit 1; fi
echo "Port $port available; dokploy-network exists. No resources were changed."
