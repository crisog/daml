#!/bin/bash
set -e

echo "Starting compile service on :8081..."
compile-service &

echo "Starting Canton sandbox on :7575..."
dpm sandbox --json-api-port 7575
