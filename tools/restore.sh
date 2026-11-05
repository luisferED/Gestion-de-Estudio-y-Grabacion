#!/bin/sh
set -eu
if [ "$#" -ne 1 ]; then echo "Usage: sh tools/restore.sh /data/backups/backup.sqlite" >&2; exit 2; fi
exec python3 tools/db-admin.py restore "$1"
