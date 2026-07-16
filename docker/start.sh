#!/bin/bash
set -e

echo "[start] Starting Paseo daemon..."
paseo daemon start --foreground &
PASEO_PID=$!

# Wait for Paseo to be ready
echo "[start] Waiting for Paseo health..."
for i in $(seq 1 30); do
  if wget -q --spider http://127.0.0.1:6767/api/health 2>/dev/null; then
    echo "[start] Paseo is healthy"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[start] ERROR: Paseo failed to start"
    exit 1
  fi
  sleep 1
done

echo "[start] Starting agent-server..."
node /app/dist/index.js &
SERVER_PID=$!

# Wait for agent-server to be ready
for i in $(seq 1 15); do
  if wget -q --spider "http://127.0.0.1:${PORT:-3000}/api/health" 2>/dev/null; then
    echo "[start] agent-server is healthy"
    break
  fi
  sleep 1
done

echo "[start] All services running (Paseo PID=$PASEO_PID, Server PID=$SERVER_PID)"

# Handle shutdown
shutdown() {
  echo "[start] Shutting down..."
  kill $SERVER_PID $PASEO_PID 2>/dev/null
  exit 0
}
trap shutdown SIGTERM SIGINT

# Keep the container running
wait $PASEO_PID $SERVER_PID
