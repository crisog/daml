#!/bin/bash
set -e

echo "Starting compile service on :8081..."
compile-service &

echo "Starting Canton sandbox on :7575..."
dpm sandbox --json-api-port 7575 \
  -C "canton.participants.sandbox.ledger-api.address=0.0.0.0" \
  -C "canton.participants.sandbox.http-ledger-api.address=0.0.0.0" \
  -C "canton.participants.sandbox.admin-api.address=0.0.0.0"
