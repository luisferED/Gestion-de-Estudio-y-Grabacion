#!/bin/sh
set -eu
exec python3 tools/db-admin.py backup "$@"
