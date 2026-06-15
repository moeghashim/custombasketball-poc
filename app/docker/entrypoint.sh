#!/bin/sh
set -eu

/usr/local/bin/sandbox-api &

count=0
while ! nc -z 127.0.0.1 8080; do
  count=$((count + 1))
  if [ "$count" -gt 300 ]; then
    echo "sandbox-api did not become ready on port 8080" >&2
    exit 1
  fi
  sleep 0.1
done

exec sleep infinity
