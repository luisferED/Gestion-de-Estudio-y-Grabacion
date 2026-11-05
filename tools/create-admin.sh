#!/bin/sh
set -eu
if [ "$#" -ne 1 ]; then echo "Usage: sh tools/create-admin.sh corporate-email" >&2; exit 2; fi
exec python3 tools/db-admin.py admin "$1"
